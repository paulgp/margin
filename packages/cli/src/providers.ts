import {Request, ReviewResponse, Provenance} from '@margin/core';
export interface ProviderResult {response: string; provenance: Provenance}
export interface Provider {name: string; run(request: Request, options?: {signal?: AbortSignal; model?: string; projectRoot?: string}): Promise<ProviderResult>}
export const mockProvider: Provider = {
  name: 'mock',
  async run(request, options) {
    options?.signal?.throwIfAborted();
    const comments: ReviewResponse['comments'] = [];
    for (const file of request.eligible_files) {
      const blocks = request.blocks.filter(b => b.file === file && b.role === 'source' && b.text.trim());
      const block = blocks.find(b => !/^(#|\\\\|=)/.test(b.text.trim()) && b.text.trim().length > 30) ?? blocks[0];
      if (!block || comments.length >= request.max_comments) continue;
      comments.push({file, block_id: block.id, quote: block.text.trim(), category: comments.length ? 'keep' : 'argument', body: comments.length ? 'Offline demonstration: this passage gives the reader a concrete point of reference. What makes it worth preserving as you revise?' : 'Offline demonstration: what evidence connects this passage to your central claim? Consider whether a reader can follow that connection.'});
    }
    return {response: JSON.stringify({schema_version: 1, request_id: request.id, summary: 'Deterministic offline demonstration, not a model assessment. These fixture comments let you try replies, resolution, movement, and comparison without sending text anywhere.', comments}), provenance: {provider: 'mock', requested_model: null, reported_model: null}};
  }
};
