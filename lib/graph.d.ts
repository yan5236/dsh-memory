/**
 * Memory graph: the relationship model behind the vault page's 3D cloud.
 *
 * Nodes are memory artifacts (MEMORY.md topics, rollout summaries, skills,
 * ad-hoc notes, retired archives). Edges are either explicit citations
 * (`cite`: a topic that names a summary file) or topical affinity (`relate`:
 * two artifacts that share distinctive keywords). Everything here is derived
 * from files on disk, so the graph never drifts from what the pipeline wrote.
 */
import type { MemoryFiles } from './files.js';
export type GraphNodeKind = 'topic' | 'summary' | 'skill' | 'note' | 'archive';
export interface GraphNode {
    id: string;
    label: string;
    kind: GraphNodeKind;
    /** Memory-relative path of the artifact this node stands for. */
    path: string;
    chars: number;
    /** Epoch ms of the artifact's last modification (0 when unknown). */
    at: number;
    degree: number;
    /** Short plain-text excerpt so the inspector needs no extra read. */
    preview: string;
}
export interface GraphEdge {
    from: string;
    to: string;
    kind: 'cite' | 'relate';
    weight: number;
}
export interface MemoryGraphPayload {
    nodes: GraphNode[];
    edges: GraphEdge[];
    stats: {
        nodes: number;
        edges: number;
        truncated: boolean;
        generatedAt: number;
    };
}
export interface GraphOptions {
    /** Upper bound on returned nodes (keeps the canvas readable). */
    maxNodes?: number;
    /** Upper bound on summary artifacts read for keyword extraction. */
    maxSummaries?: number;
    /** Bytes read per artifact for keyword extraction. */
    readCap?: number;
    /** Related edges kept per node. */
    relatedPerNode?: number;
    /** Total relate-edge budget; the strongest pairs win. */
    maxRelatedEdges?: number;
    /** Injectable clock for deterministic tests. */
    now?: () => number;
}
/** Tokenize one artifact body into distinctive ASCII words and CJK bigrams. */
export declare function tokenize(text: string): string[];
/**
 * First line worth showing as a node label: HTML comment frontmatter is
 * skipped entirely, and a markdown heading wins over loose prose.
 */
export declare function firstMeaningfulLine(content: string | undefined, fallback: string): string;
/** Split MEMORY.md into `##`/`###` topics with their bodies. */
export declare function parseTopics(memory: string): Array<{
    label: string;
    body: string;
}>;
/** Build the node/edge payload consumed by the vault page's 3D cloud. */
export declare function buildMemoryGraph(files: MemoryFiles, options?: GraphOptions): Promise<MemoryGraphPayload>;
/** One-line plain-text excerpt for the inspector (comments/markdown stripped). */
export declare function previewOf(content: string | undefined, cap?: number): string;
/** Resolve one graph node back to its artifact path (guarded against unknown ids). */
export declare function pathOfNode(payload: MemoryGraphPayload, id: string): string | undefined;
//# sourceMappingURL=graph.d.ts.map