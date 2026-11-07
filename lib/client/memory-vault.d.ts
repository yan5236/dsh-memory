/**
 * 记忆库 — the vault page: a 3D memory cloud plus an in-place editor.
 *
 * Opened from the sidebar's 记忆库 entry (slot `sidebar.panellist` renders the
 * icon, slot `main` with key `dsh-memory-vault` renders this page). All data
 * comes from the plugin's own RPC route, so the page never reads files
 * directly and the memory root stays owned by the host side.
 */
import * as React from 'react';
declare const PANEL_ID = "dsh-memory-vault";
/** Sidebar icon: a small constellation, drawn as inline SVG (no host imports). */
export declare function VaultPanelIcon(props: {
    size?: number;
    active?: boolean;
}): React.ReactNode;
export declare function MemoryVaultPage(): React.ReactNode;
export { PANEL_ID };
//# sourceMappingURL=memory-vault.d.ts.map