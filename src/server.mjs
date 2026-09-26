import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Manager, DomainError } from './manager.mjs';
import { schemas } from './schemas.mjs';

const manager = new Manager();
function createServer() {
const server = new McpServer({ name: 'board-games-mcp', version: '1.0.0' }, {
  instructions: 'Manage puzzle games through drafts. First inspect get_game, then validate_import and save_draft with the current draft version. Omitted stories and clues are preserved. Only publish_draft changes live content; call it only for an explicitly approved latest draft version with the current published version. Public players see only their common surface and current clue. Never place host-only notes in public text. Asset paths refer to the MCP server filesystem.'
});
const descriptions = {
  list_games: 'List published and draft games with version tokens. Read-only.',
  get_game: 'Read one published game or latest draft, version tokens and asset IDs. Host notes omitted unless explicitly requested.',
  validate_import: 'Validate an incremental puzzle-game patch without changing files, chapters, NFC or public content. Omitted siblings are preserved.',
  save_draft: 'Save a new immutable draft after optimistic version checking. Never publishes. expectedDraftVersion is null only for the first draft.',
  preview_clue: 'Return a private HTML preview containing only the selected latest-draft clue and common surface. Does not expose draft audio publicly.',
  publish_draft: 'Explicitly publish the exact latest draft, checking both draft and current published versions. Existing content IDs and NFC codes persist.',
  import_asset: 'Register audio from the controlled server-side import directory. Save a game draft first. Returns a game-scoped asset ID without publishing.',
  export_links: 'Export canonical URLs and stable NFC URLs for published content only; supports puzzle clues and existing audio chapters.'
};
for (const [name, inputSchema] of Object.entries(schemas)) {
  const readOnly = ['list_games', 'get_game', 'validate_import', 'preview_clue', 'export_links'].includes(name);
  server.registerTool(name, {
    description: descriptions[name], inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: name === 'publish_draft', idempotentHint: readOnly || name === 'publish_draft' || name === 'import_asset', openWorldHint: false }
  }, async args => {
    try {
      const result = manager[name](args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const result = error instanceof DomainError ? { code: error.code, message: error.message }
        : error.name === 'ZodError' ? { code: 'VALIDATION', message: 'Invalid manifest', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }
        : { code: error.code === 'ENOENT' ? 'NOT_FOUND' : 'STORAGE', message: error.code === 'ENOENT' ? 'Required file does not exist on the MCP server' : 'Storage operation failed; check permissions and server logs' };
      if (!(error instanceof DomainError) && error.name !== 'ZodError') console.error(`board-games-mcp: ${error.code || error.name}`);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  });
}
return server;
}
serveStdio(createServer, { onerror: error => console.error(`board-games-mcp protocol: ${error.message}`) });
