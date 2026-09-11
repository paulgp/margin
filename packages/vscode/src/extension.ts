import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  Session, ReviewState, ReviewComment, Attachment, Evidence, Generation, Discussion,
  listSessions, loadSession, loadState, saveState, snapshotText, config, sourcePath, safePath,
  readBytes, decode, attach, mapEdits, offsetPosition, manualOverride, id, gitContext,
} from '@margin/core';
import {nextOpenComment, reviewProgress} from './navigation';

function plain(text: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(); md.isTrusted = false; md.supportHtml = false; md.supportThemeIcons = false;
  md.appendText(text); return md;
}
function range(text: string, start: number, end: number): vscode.Range {
  const a = offsetPosition(text, start), b = offsetPosition(text, end);
  return new vscode.Range(a.line, a.character, b.line, b.character);
}
interface Item {id: string}
class Margin implements vscode.TreeDataProvider<Item>, vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changes.event;
  private readonly controller = vscode.comments.createCommentController('margin', 'Margin');
  private readonly threads = new Map<string, vscode.CommentThread>();
  private readonly threadIds = new WeakMap<vscode.CommentThread, string>();
  private readonly generation = new Generation();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  private readonly decoration = vscode.window.createTextEditorDecorationType({backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'), border: '0 0 1px 0', borderColor: new vscode.ThemeColor('editorInfo.foreground'), rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed});
  private readonly changedDecoration = vscode.window.createTextEditorDecorationType({textDecoration: 'underline dotted', color: new vscode.ThemeColor('editorWarning.foreground'), rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed});
  private timer?: NodeJS.Timeout;
  private selected?: Session;
  private state?: ReviewState;
  private token: string | null = null;
  private attachments = new Map<string, Attachment>();
  private texts = new Map<string, string>();
  private reviewed = new Map<string, string>();
  private allowed = new Set<string>();
  private filter: Discussion | 'all' = 'all';
  private known = new Set<string>();
  private warning = '';
  private gitLabel = '';
  private current?: string;
  private navigation: Promise<unknown> = Promise.resolve();
  private readonly locationGeneration = new Generation();
  private reviewEpoch = 0;
  private readonly tree: vscode.TreeView<Item>;
  constructor(private readonly context: vscode.ExtensionContext, private readonly root: string) {
    this.tree = vscode.window.createTreeView('margin.reviews', {treeDataProvider: this});
    this.status.command = 'margin.selectReview'; this.status.show();
    this.controller.options = {prompt: 'Reply locally in Margin', placeHolder: 'Your reply stays in this review session.'};
    this.disposables.push(this.tree, this.controller, this.status, this.decoration, this.changedDecoration, this.changes,
      vscode.workspace.registerTextDocumentContentProvider('margin', this),
      vscode.workspace.onDidChangeTextDocument(e => this.onEdit(e)),
      vscode.workspace.onDidOpenTextDocument(d => { if (d.uri.scheme === 'file' && this.allowed.has(this.relative(d.uri))) this.schedule(); }),
      vscode.workspace.onDidCloseTextDocument(d => { if (d.uri.scheme === 'file' && this.allowed.has(this.relative(d.uri))) this.schedule(); }),
      vscode.workspace.onDidSaveTextDocument(d => { if (this.allowed.has(this.relative(d.uri))) this.schedule(); }),
      vscode.window.onDidChangeActiveTextEditor(() => this.decorate()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()));
    const sidecars = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '.reviews/**/*.json'));
    const sources = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*.{md,markdown,tex,typ}'));
    for (const watcher of [sidecars, sources]) this.disposables.push(watcher, watcher.onDidCreate(uri => this.changedFile(uri)), watcher.onDidChange(uri => this.changedFile(uri)), watcher.onDidDelete(uri => this.changedFile(uri)));
    // Git may use an external worktree gitdir; polling only HEAD/branch is portable and read-only.
    const poll = setInterval(() => { if (this.selected) { const git = gitContext(this.root); if (`${git.branch ?? 'no branch'} @ ${git.head ?? 'no HEAD'}` !== this.gitLabel) this.schedule(); } }, 5000);
    this.disposables.push({dispose: () => clearInterval(poll)});
    this.command('selectReview', a => this.selectReview(a)); this.command('refresh', () => this.refresh());
    this.command('filter', async a => { const choice = typeof a === 'string' ? a : await vscode.window.showQuickPick(['all', 'open', 'resolved', 'dismissed'], {title: 'Margin discussion filter'}); if (choice && ['all', 'open', 'resolved', 'dismissed'].includes(choice)) { this.filter = choice as typeof this.filter; this.render(); } });
    this.command('letter', () => this.letter()); this.navigationCommand('open', a => this.open(a));
    this.navigationCommand('nextOpen', () => this.navigate(1));
    this.navigationCommand('previousOpen', () => this.navigate(-1));
    this.navigationCommand('resolveAndNext', a => this.setStatusAndNext(a, 'resolved'));
    this.navigationCommand('dismissAndNext', a => this.setStatusAndNext(a, 'dismissed'));
    this.command('original', a => this.original(a)); this.command('compare', a => this.compare(a));
    this.command('reattach', a => this.reattach(a)); this.command('reply', a => this.reply(a));
    for (const status of ['resolved', 'dismissed', 'open'] as const) this.command(status === 'open' ? 'reopen' : status === 'resolved' ? 'resolve' : 'dismiss', a => this.setStatus(a, status));
  }
  private command(name: string, action: (arg?: any) => unknown): void {
    this.disposables.push(vscode.commands.registerCommand(`margin.${name}`, async arg => {
      try { if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Margin'); await action(arg); }
      catch (e) { void vscode.window.showErrorMessage(`Margin: ${(e as Error).message}`); }
    }));
  }
  private navigationCommand(name: string, action: (arg?: any) => Promise<void>): void {
    this.command(name, arg => {
      const epoch = this.reviewEpoch;
      const pending = this.navigation.then(async () => { if (this.reviewEpoch === epoch) await action(arg); });
      // Rapid key presses execute in order; a failed write cannot poison later navigation.
      this.navigation = pending.catch(() => {});
      return pending;
    });
  }
  async start(): Promise<void> {
    this.known = new Set(listSessions(this.root));
    const selected = this.context.workspaceState.get<string>('margin.selected');
    if (selected && this.known.has(selected)) this.selected = loadSession(this.root, selected);
    else if (this.known.size === 1) { this.selected = loadSession(this.root, [...this.known][0]); await this.context.workspaceState.update('margin.selected', this.selected.id); }
    await this.refresh();
  }
  private relative(uri: vscode.Uri): string { return path.relative(this.root, uri.fsPath).split(path.sep).join('/'); }
  private changedFile(uri: vscode.Uri): void {
    const rel = this.relative(uri);
    if (rel.startsWith('.reviews/') || this.allowed.has(rel)) this.schedule();
  }
  private schedule(): void {
    this.generation.next(); if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh().catch(e => vscode.window.showErrorMessage(`Margin: ${e.message}`)); }, 180);
  }
  private async selectReview(arg?: Item): Promise<void> {
    const sessions = listSessions(this.root).map(id => loadSession(this.root, id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const choices = sessions.map(s => ({label: `${s.created_at} · ${s.provenance.provider}`, description: s.id, detail: s.brief, session: s}));
    const choice = arg?.id ? choices.find(s => s.session.id === arg.id) : await vscode.window.showQuickPick(choices, {title: 'Select Margin review session'});
    if (arg?.id && !choice) throw new Error('Review session not found');
    if (!choice) return;
    this.reviewEpoch++; this.locationGeneration.next(); this.current = undefined;
    for (const thread of this.threads.values()) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    this.generation.next(); this.selected = choice.session;
    await this.context.workspaceState.update('margin.selected', choice.session.id); await this.refresh();
  }
  async refresh(): Promise<void> {
    const gen = this.generation.next();
    const sessions = listSessions(this.root); const fresh = sessions.filter(id => !this.known.has(id)); this.known = new Set(sessions);
    if (fresh.length) void vscode.window.showInformationMessage(`${fresh.length} new Margin review(s) available.`, 'Select Review').then(choice => { if (choice) void this.selectReview(); });
    if (!this.selected) { this.decorate(); this.tree.message = 'Generate a review with margin review, then select it here.'; return; }
    const session = loadSession(this.root, this.selected.id), stored = loadState(this.root, session);
    const cfg = config(this.root);
    const allowed = new Set([...session.eligible_files, ...cfg.files]);
    const texts = new Map<string, string>(), reviewed = new Map<string, string>(); let warning = '';
    for (const file of allowed) {
      sourcePath(file);
      try {
        // Validate path even when an unsaved buffer is already open.
        safePath(this.root, file, true);
        const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && this.relative(d.uri) === file);
        const text = open ? open.getText() : decode(readBytes(this.root, file, cfg.limits.file_bytes));
        if (Buffer.byteLength(text) > cfg.limits.file_bytes) throw new Error(`${file}: current buffer exceeds configured file limit`);
        texts.set(file, text);
      } catch (e) { warning = `Some targets unavailable: ${(e as Error).message}`; }
    }
    for (const c of session.comments) if (!reviewed.has(c.anchor.path)) reviewed.set(c.anchor.path, snapshotText(this.root, session.snapshot_id, c.anchor.path));
    // Yield once; a later refresh/edit must invalidate this calculation before publication.
    await Promise.resolve();
    if (!this.generation.isCurrent(gen)) return;
    const attachments = new Map<string, Attachment>();
    for (const c of session.comments) {
      const override = stored.state.comments[c.id].override;
      const a = attach(override ?? c.anchor, override?.source_text ?? reviewed.get(c.anchor.path)!, texts);
      a.unsaved = a.path ? !!vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && this.relative(d.uri) === a.path)?.isDirty : false;
      if (override?.unsaved) a.reason += '; manual attachment was made in an unsaved buffer and has been revalidated';
      attachments.set(c.id, a);
    }
    this.selected = session; this.state = stored.state; this.token = stored.token; this.allowed = allowed;
    this.texts = texts; this.reviewed = reviewed; this.attachments = attachments; this.warning = warning;
    const git = gitContext(this.root); this.gitLabel = `${git.branch ?? 'no branch'} @ ${git.head ?? 'no HEAD'}`;
    this.render();
  }
  private anchor(c: ReviewComment): Evidence { return this.state?.comments[c.id].override ?? c.anchor; }
  private onEdit(event: vscode.TextDocumentChangeEvent): void {
    const file = this.relative(event.document.uri);
    if (event.document.uri.scheme !== 'file' || !this.allowed.has(file) || !this.selected) return;
    this.generation.next();
    const before = this.texts.get(file), after = event.document.getText();
    this.texts.set(file, after);
    if (before === undefined) { this.schedule(); return; }
    for (const c of this.selected.comments) {
      const a = this.attachments.get(c.id)!; let next = a;
      const anchor = this.anchor(c), original = this.state?.comments[c.id].override?.source_text ?? this.reviewed.get(c.anchor.path)!;
      const whole = event.contentChanges.some(e => e.rangeOffset === 0 && e.rangeLength === before.length);
      if (a.path === file && a.start !== undefined && !whole) next = mapEdits(anchor, a, before, event.contentChanges, after);
      if (whole || next.status === 'unanchored') next = attach(anchor, original, this.texts);
      next.unsaved = next.path ? !!vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && this.relative(d.uri) === next.path)?.isDirty : false;
      this.attachments.set(c.id, next);
    }
    this.render();
  }
  private render(): void {
    const collapsed = new Map([...this.threads].map(([id, t]) => [id, t.collapsibleState]));
    for (const t of this.threads.values()) t.dispose(); this.threads.clear();
    if (!this.selected || !this.state) return;
    for (const c of this.selected.comments) {
      const a = this.attachments.get(c.id), state = this.state.comments[c.id];
      if (!a?.path || a.start === undefined || a.end === undefined || a.status === 'unanchored' || !this.visible(c.id)) continue;
      const text = this.texts.get(a.path)!;
      const body = `[${c.category}] ${a.status}${a.unsaved ? ' · UNSAVED BUFFER' : ''} · ${state.status}\n\n${c.body}\n\nOriginal quotation:\n${c.anchor.quote}\n\n${a.reason}`;
      const comments: vscode.Comment[] = [{body: plain(body), mode: vscode.CommentMode.Preview, author: {name: `Margin · ${this.selected.provenance.provider}`}, contextValue: 'marginComment'}, ...state.replies.map(r => ({body: plain(r.body), mode: vscode.CommentMode.Preview, author: {name: 'You (local)'}, timestamp: new Date(r.created_at)}))];
      const t = this.controller.createCommentThread(vscode.Uri.file(path.join(this.root, a.path)), range(text, a.start, a.end), comments);
      t.contextValue = 'marginComment'; t.label = `${c.category} · ${a.status} · ${state.status}${a.unsaved ? ' · unsaved' : ''}`;
      t.canReply = true; t.state = state.status === 'open' ? vscode.CommentThreadState.Unresolved : vscode.CommentThreadState.Resolved;
      t.collapsibleState = collapsed.get(c.id) ?? vscode.CommentThreadCollapsibleState.Collapsed;
      this.threads.set(c.id, t); this.threadIds.set(t, c.id);
    }
    this.tree.message = `${this.selected.provenance.provider} · ${this.filter} · Decisions belong to this session\nCurrent: ${this.gitLabel}${this.warning ? '\n' + this.warning : ''}`;
    const progress = reviewProgress(this.selected, this.state);
    this.tree.description = `${progress.open} of ${progress.total} open`;
    this.changes.fire(); this.decorate();
  }
  private visible(id: string): boolean { return this.filter === 'all' || this.state?.comments[id].status === this.filter; }
  private decorate(): void {
    const active = vscode.window.activeTextEditor;
    const progress = this.selected && this.state ? reviewProgress(this.selected, this.state) : undefined;
    const current = this.selected?.comments.find(c => c.id === this.current);
    this.status.text = `Margin: ${progress ? `${progress.open} of ${progress.total} open` : 'Select Review'}${active?.document.isDirty && this.allowed.has(this.relative(active.document.uri)) ? ' · UNSAVED BUFFER ≠ saved snapshot' : ''}`;
    this.status.tooltip = `${progress ? 'Click for the next open comment. ' : ''}Margin reviews saved disk snapshots. Discussion decisions apply only to the selected review session.${current ? `\nCurrent comment: ${current.category}: ${current.body.slice(0, 120)}` : ''}`;
    this.status.command = progress ? 'margin.nextOpen' : 'margin.selectReview';
    void vscode.commands.executeCommand('setContext', 'margin.hasReview', !!progress);
    for (const editor of vscode.window.visibleTextEditors) {
      const file = this.relative(editor.document.uri); const attached: vscode.Range[] = [], changed: vscode.Range[] = [];
      if (editor.document.uri.scheme === 'file') for (const [id, a] of this.attachments) {
        if (a.path === file && a.start !== undefined && a.end !== undefined && this.visible(id) && this.state?.comments[id].status === 'open') (a.status === 'attached' ? attached : changed).push(range(editor.document.getText(), a.start, a.end));
      }
      editor.setDecorations(this.decoration, attached); editor.setDecorations(this.changedDecoration, changed);
    }
  }
  getChildren(): Item[] { return this.selected?.comments.filter(c => this.visible(c.id)).map(c => ({id: c.id})) ?? []; }
  getParent(): undefined { return undefined; }
  getTreeItem(item: Item): vscode.TreeItem {
    const c = this.selected!.comments.find(c => c.id === item.id)!, a = this.attachments.get(c.id)!;
    const result = new vscode.TreeItem(`${c.category}: ${c.body.replace(/\s+/g, ' ').slice(0, 85)}`);
    result.id = c.id; result.contextValue = 'marginComment'; result.description = `${this.state!.comments[c.id].status} · ${a.status}${a.unsaved ? ' · unsaved' : ''}${this.current === c.id ? ' · current' : ''}`;
    result.tooltip = `${c.body}\n\n${a.reason}\nOriginal: ${c.anchor.path}`;
    result.iconPath = new vscode.ThemeIcon(a.status === 'attached' ? 'comment-discussion' : a.status === 'changed' ? 'warning' : 'debug-disconnect');
    result.command = {command: 'margin.open', title: 'Open Comment', arguments: [item]}; return result;
  }
  private async comment(arg?: any): Promise<ReviewComment | undefined> {
    const session = this.selected;
    const candidate = arg?.thread ?? arg; let target = candidate?.id as string | undefined;
    if (candidate && typeof candidate === 'object') target ??= this.threadIds.get(candidate);
    if (!target && this.selected) {
      const picked = await vscode.window.showQuickPick(this.selected.comments.map(c => ({label: `${c.category}: ${c.body.slice(0, 90)}`, id: c.id})), {title: 'Choose Margin comment'}); target = picked?.id;
    }
    return this.selected?.id === session?.id ? this.selected?.comments.find(c => c.id === target) : undefined;
  }
  private uri(kind: 'snapshot' | 'letter', c?: ReviewComment): vscode.Uri {
    return vscode.Uri.from({scheme: 'margin', path: `/${kind}/${c?.anchor.path ?? 'editorial-letter.txt'}`, query: new URLSearchParams({review: this.selected!.id, file: c?.anchor.path ?? ''}).toString()});
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query); const session = loadSession(this.root, params.get('review') ?? '');
    if (uri.path.startsWith('/letter/')) return `Margin editorial letter\n${session.created_at} · ${session.provenance.provider}\nRequested model: ${session.provenance.requested_model ?? 'unspecified'}\nReported model: ${session.provenance.reported_model ?? 'not reported'}\nBrief: ${session.brief}\n\n${session.summary}`;
    return snapshotText(this.root, session.snapshot_id, params.get('file') ?? '');
  }
  private async letter(): Promise<void> { if (!this.selected) throw new Error('Select a review first'); await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(this.uri('letter')), {preview: true}); }
  private async original(arg?: any): Promise<void> {
    const c = await this.comment(arg); if (!c) return;
    const doc = await vscode.workspace.openTextDocument(this.uri('snapshot', c));
    await vscode.window.showTextDocument(doc, {selection: range(doc.getText(), c.anchor.start, c.anchor.end), preview: true});
  }
  private async open(arg?: any, retry = true): Promise<void> {
    const c = await this.comment(arg); if (!c || !this.selected) return;
    const session = this.selected.id, gen = this.locationGeneration.next();
    const valid = () => this.selected?.id === session && this.locationGeneration.isCurrent(gen);
    const a = this.attachments.get(c.id);
    const detached = !a?.path || a.start === undefined || a.end === undefined || a.status === 'unanchored';
    if (!detached) safePath(this.root, a.path!, true);
    const doc = await vscode.workspace.openTextDocument(detached ? this.uri('snapshot', c) : vscode.Uri.file(path.join(this.root, a!.path!)));
    if (!valid()) return;
    // Opening a document can trigger a refresh. Read the latest buffer attachment before revealing it.
    const latest = this.attachments.get(c.id);
    if (!detached && (!latest?.path || latest.path !== a!.path || latest.start === undefined || latest.end === undefined || latest.status === 'unanchored')) {
      if (!retry) throw new Error('The passage changed while opening. Refresh and try again.');
      await this.open({id: c.id}, false); return;
    }
    const selection = detached ? range(doc.getText(), c.anchor.start, c.anchor.end) : range(doc.getText(), latest!.start!, latest!.end!);
    await vscode.window.showTextDocument(doc, {selection, preview: true});
    if (!valid()) return;
    if (!this.visible(c.id)) { this.filter = 'all'; this.render(); }
    const previous = this.current && this.threads.get(this.current);
    if (previous && this.current !== c.id) previous.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    this.current = c.id;
    const thread = this.threads.get(c.id); if (thread) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.changes.fire(); this.decorate();
    await this.tree.reveal({id: c.id}, {select: true, focus: false});
  }
  private async navigate(direction: 1 | -1): Promise<void> {
    if (!this.selected || !this.state) throw new Error('Select a review first');
    const target = nextOpenComment(this.selected, this.state, this.current, direction);
    if (!target) { void vscode.window.showInformationMessage('No open comments remain in this review. Resolved and dismissed comments are still available in the review tree.'); return; }
    if (this.filter !== 'all' && this.filter !== 'open') { this.filter = 'open'; this.render(); }
    await this.open({id: target});
  }
  private async compare(arg?: any): Promise<void> {
    const c = await this.comment(arg); if (!c) return; const a = this.attachments.get(c.id);
    const file = a?.path ?? (this.texts.has(c.anchor.path) ? c.anchor.path : undefined);
    if (!file) { await this.original({id: c.id}); void vscode.window.showInformationMessage('Current target is missing. Showing the immutable original.'); return; }
    safePath(this.root, file, true);
    const text = this.texts.get(file)!; const start = a?.start ?? 0, end = a?.end ?? 0;
    await vscode.commands.executeCommand('vscode.diff', this.uri('snapshot', c), vscode.Uri.file(path.join(this.root, file)), `Margin: reviewed ↔ current · ${file}`, {preview: true, selection: range(text, start, end)});
  }
  private persist(next: ReviewState): void {
    if (!this.selected) return;
    const saved = saveState(this.root, this.selected, next, this.token);
    this.generation.next(); // A refresh that read older state must not overwrite this successful decision.
    this.state = saved.state; this.token = saved.token; this.render();
  }
  private async setStatus(arg: any, status: Discussion): Promise<void> {
    const c = await this.comment(arg); if (!c || !this.state) return;
    const next = structuredClone(this.state); next.comments[c.id].status = status; this.persist(next);
    // Persist first: a failed state write must leave the discussion visible.
    // persist() recreates the threads, so collapse the current instance afterward.
    const thread = this.threads.get(c.id);
    if (thread && status !== 'open') thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
  }
  private async setStatusAndNext(arg: any, status: 'resolved' | 'dismissed'): Promise<void> {
    const c = await this.comment(arg ?? (this.current ? {id: this.current} : undefined));
    if (!c || !this.state) return;
    if (this.state.comments[c.id].status !== 'open') throw new Error('Choose an open comment to resolve or dismiss and advance');
    const session = this.selected!.id;
    await this.setStatus({id: c.id}, status);
    if (this.selected?.id !== session) return;
    this.current = c.id; this.changes.fire(); this.decorate();
    await this.navigate(1);
  }
  private async reply(arg?: any): Promise<void> {
    const c = await this.comment(arg); if (!c || !this.state) return;
    const text: string | undefined = typeof arg?.text === 'string' ? arg.text : await vscode.window.showInputBox({title: 'Local reply', prompt: 'Stored only in this Margin review', validateInput: text => text.length > 8000 ? 'Maximum 8000 characters' : undefined});
    if (!text?.trim()) return;
    const next = structuredClone(this.state); next.comments[c.id].replies.push({id: id('reply'), body: text, created_at: new Date().toISOString()}); this.persist(next);
  }
  private async reattach(arg?: any): Promise<void> {
    // Capture the user's editor selection before a comment chooser can change focus.
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file' || editor.selection.isEmpty) throw new Error('Select a nonempty passage in an eligible source file first');
    const file = this.relative(editor.document.uri); sourcePath(file); safePath(this.root, file, true);
    if (!this.allowed.has(file)) throw new Error('Selection must belong to this session or an explicitly selected config.json file');
    const override = manualOverride(file, editor.document.getText(), editor.document.offsetAt(editor.selection.start), editor.document.offsetAt(editor.selection.end), editor.document.isDirty);
    const c = await this.comment(arg); if (!c || !this.state) return;
    const next = structuredClone(this.state); next.comments[c.id].override = override; this.persist(next); await this.refresh();
  }
  /** Read-only diagnostics for the Extension Development Host smoke test. */
  inspect() { return {session: this.selected?.id, threads: this.threads.size, threadStates: Object.fromEntries([...this.threads].map(([id, thread]) => [id, thread.collapsibleState])), items: this.getChildren().length, attachments: [...this.attachments.values()], current: this.current, filter: this.filter, progress: this.selected && this.state ? reviewProgress(this.selected, this.state) : undefined, statusText: this.status.text, treeDescription: this.tree.description}; }
  dispose(): void { this.reviewEpoch++; this.generation.next(); this.locationGeneration.next(); if (this.timer) clearTimeout(this.timer); for (const t of this.threads.values()) t.dispose(); for (const d of this.disposables) d.dispose(); void vscode.commands.executeCommand('setContext', 'margin.hasReview', false); }
}
export async function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) return;
  const root = vscode.workspace.workspaceFolders?.[0]; if (!root || root.uri.scheme !== 'file') return;
  const margin = new Margin(context, root.uri.fsPath); context.subscriptions.push(margin);
  try { await margin.start(); } catch (e) { void vscode.window.showErrorMessage(`Margin: ${(e as Error).message}`); }
  return {inspect: () => margin.inspect()};
}
