#!/usr/bin/env node
/**
 * Paper Search MCP Server - Node.js Implementation
 * Rebuilt with official MCP SDK pattern using StreamableHTTPServerTransport
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import http from 'http';
import { randomUUID } from 'crypto';
import { ArxivSearcher } from './platforms/ArxivSearcher.js';
import { WebOfScienceSearcher } from './platforms/WebOfScienceSearcher.js';
import { PubMedSearcher } from './platforms/PubMedSearcher.js';
import { BioRxivSearcher, MedRxivSearcher } from './platforms/BioRxivSearcher.js';
import { SemanticScholarSearcher } from './platforms/SemanticScholarSearcher.js';
import { IACRSearcher } from './platforms/IACRSearcher.js';
import { GoogleScholarSearcher } from './platforms/GoogleScholarSearcher.js';
import { SciHubSearcher } from './platforms/SciHubSearcher.js';
import { ScienceDirectSearcher } from './platforms/ScienceDirectSearcher.js';
import { SpringerSearcher } from './platforms/SpringerSearcher.js';
import { WileySearcher } from './platforms/WileySearcher.js';
import { ScopusSearcher } from './platforms/ScopusSearcher.js';
import { PaperFactory, Paper } from './models/Paper.js';
import { PaperSource } from './platforms/PaperSource.js';
import { logToolCall, logToolResponse, logAccess, logError, logInfo } from './utils/logger.js';

// 환경변수 로드
dotenv.config();

// 개발 모드 확인
const isDevelopment = process.env.NODE_ENV === 'development';

// 디버그 로그 함수
const debugLog = (...messages: any[]) => {
  if (isDevelopment) {
    console.error('[DEBUG]', ...messages);
  }
};

// MCP 서버 인스턴스 생성
const server = new Server({
  name: 'paper-search-mcp-nodejs',
  version: '0.3.0'
}, {
  capabilities: {
    tools: {}
  }
});

// 검색기 인스턴스 (지연 초기화)
let searchers: {
  arxiv: ArxivSearcher;
  webofscience: WebOfScienceSearcher;
  pubmed: PubMedSearcher;
  wos: WebOfScienceSearcher;
  biorxiv: BioRxivSearcher;
  medrxiv: MedRxivSearcher;
  semantic: SemanticScholarSearcher;
  iacr: IACRSearcher;
  googlescholar: GoogleScholarSearcher;
  scholar: GoogleScholarSearcher;
  scihub: SciHubSearcher;
  sciencedirect: ScienceDirectSearcher;
  springer: SpringerSearcher;
  wiley: WileySearcher;
  scopus: ScopusSearcher;
} | null = null;

const initializeSearchers = () => {
  if (searchers) return searchers;

  debugLog('Initializing searchers...');

  const arxivSearcher = new ArxivSearcher();
  const wosSearcher = new WebOfScienceSearcher(
    process.env.WOS_API_KEY,
    process.env.WOS_API_VERSION || 'v1'
  );
  const pubmedSearcher = new PubMedSearcher(process.env.PUBMED_API_KEY);
  const biorxivSearcher = new BioRxivSearcher('biorxiv');
  const medrxivSearcher = new MedRxivSearcher();
  const semanticSearcher = new SemanticScholarSearcher(process.env.SEMANTIC_SCHOLAR_API_KEY);
  const iacrSearcher = new IACRSearcher();
  const googleScholarSearcher = new GoogleScholarSearcher();
  const sciHubSearcher = new SciHubSearcher();
  const scienceDirectSearcher = new ScienceDirectSearcher(process.env.ELSEVIER_API_KEY);
  const springerSearcher = new SpringerSearcher(
    process.env.SPRINGER_API_KEY,
    process.env.SPRINGER_OPENACCESS_API_KEY
  );
  const wileySearcher = new WileySearcher(process.env.WILEY_TDM_TOKEN);
  const scopusSearcher = new ScopusSearcher(process.env.ELSEVIER_API_KEY);

  searchers = {
    arxiv: arxivSearcher,
    webofscience: wosSearcher,
    pubmed: pubmedSearcher,
    wos: wosSearcher,
    biorxiv: biorxivSearcher,
    medrxiv: medrxivSearcher,
    semantic: semanticSearcher,
    iacr: iacrSearcher,
    googlescholar: googleScholarSearcher,
    scholar: googleScholarSearcher,
    scihub: sciHubSearcher,
    sciencedirect: scienceDirectSearcher,
    springer: springerSearcher,
    wiley: wileySearcher,
    scopus: scopusSearcher
  };

  debugLog('Searchers initialized successfully');
  return searchers;
};

// 도구 정의
const TOOLS: Tool[] = [
  {
    name: 'search_papers',
    description: 'Search academic papers from multiple sources including arXiv, Web of Science, PubMed, and more',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        platform: {
          type: 'string',
          enum: ['arxiv', 'webofscience', 'pubmed', 'wos', 'biorxiv', 'medrxiv', 'semantic', 'iacr', 'googlescholar', 'scholar', 'scihub', 'sciencedirect', 'springer', 'wiley', 'scopus', 'all'],
          description: 'Platform to search (default: all)'
        },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return (default: 10)'
        },
        year: { type: 'string', description: 'Year filter (e.g., "2023", "2020-2023")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_arxiv',
    description: 'Search academic papers specifically from arXiv preprint server',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: { type: 'number', minimum: 1, maximum: 50, description: 'Maximum results (default: 10)' },
        category: { type: 'string', description: 'arXiv category filter (e.g., cs.AI)' },
        author: { type: 'string', description: 'Author name filter' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_pubmed',
    description: 'Search biomedical literature from PubMed/MEDLINE database',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: { type: 'number', minimum: 1, maximum: 100, description: 'Maximum results (default: 10)' },
        year: { type: 'string', description: 'Publication year filter (e.g., "2023")' },
        author: { type: 'string', description: 'Author name filter' },
        journal: { type: 'string', description: 'Journal name filter' }
      },
      required: ['query']
    }
  },
  {
    name: 'download_paper',
    description: 'Download PDF file of an academic paper',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: { type: 'string', description: 'Paper ID (e.g., arXiv ID, DOI)' },
        platform: { type: 'string', enum: ['arxiv', 'biorxiv', 'medrxiv', 'semantic', 'iacr', 'scihub', 'springer', 'wiley'], description: 'Platform' },
        savePath: { type: 'string', description: 'Directory to save PDF (default: ./downloads)' }
      },
      required: ['paperId', 'platform']
    }
  },
  {
    name: 'get_platform_status',
    description: 'Check the status and capabilities of available academic platforms',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// Tools/list 핸들러
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog('Received tools/list request');
  return { tools: TOOLS };
});

// Tools/call 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();
  let success = true;
  let errorMessage: string | undefined;

  debugLog(`Tool called: ${name}`, args);
  logToolCall(name, args);

  try {
    const currentSearchers = initializeSearchers();

    switch (name) {
      case 'search_papers': {
        const { query, platform = 'all', maxResults = 10, year, author } = args as any;
        const results = [];
        const searchOptions = { maxResults, year, author };

        if (platform === 'all') {
          // 랜덤 플랫폼 선택 (빠른 응답)
          const availablePlatforms = ['arxiv', 'pubmed', 'semantic', 'biorxiv'];
          const randomPlatform = availablePlatforms[Math.floor(Math.random() * availablePlatforms.length)];

          debugLog(`Randomly selected platform: ${randomPlatform}`);

          try {
            const searcher = currentSearchers[randomPlatform as keyof typeof currentSearchers];
            const platformResults = await (searcher as PaperSource).search(query, searchOptions);
            results.push(...platformResults.map((paper: Paper) => PaperFactory.toDict(paper)));
          } catch (error) {
            debugLog(`Error searching ${randomPlatform}:`, error);
            // 실패시 arxiv fallback
            const platformResults = await currentSearchers.arxiv.search(query, searchOptions);
            results.push(...platformResults.map((paper: Paper) => PaperFactory.toDict(paper)));
          }
        } else {
          const searcher = currentSearchers[platform as keyof typeof currentSearchers];
          if (!searcher) throw new Error(`Unsupported platform: ${platform}`);
          const platformResults = await (searcher as PaperSource).search(query, searchOptions);
          results.push(...platformResults.map((paper: Paper) => PaperFactory.toDict(paper)));
        }

        return {
          content: [{
            type: 'text',
            text: `Found ${results.length} papers.\n\n${JSON.stringify(results, null, 2)}`
          }]
        };
      }

      case 'search_arxiv': {
        const { query, maxResults = 10, category, author } = args as any;
        const results = await currentSearchers.arxiv.search(query, { maxResults, category, author });
        return {
          content: [{
            type: 'text',
            text: `Found ${results.length} arXiv papers.\n\n${JSON.stringify(
              results.map((paper: Paper) => PaperFactory.toDict(paper)), null, 2
            )}`
          }]
        };
      }

      case 'search_pubmed': {
        const { query, maxResults = 10, year, author, journal } = args as any;
        const results = await currentSearchers.pubmed.search(query, { maxResults, year, author, journal });
        return {
          content: [{
            type: 'text',
            text: `Found ${results.length} PubMed papers.\n\n${JSON.stringify(
              results.map((paper: Paper) => PaperFactory.toDict(paper)), null, 2
            )}`
          }]
        };
      }

      case 'download_paper': {
        const { paperId, platform, savePath = './downloads' } = args as any;
        const searcher = currentSearchers[platform as keyof typeof currentSearchers];
        if (!searcher) throw new Error(`Unsupported platform: ${platform}`);
        if (!searcher.getCapabilities().download) throw new Error(`Platform ${platform} does not support download`);
        const filePath = await searcher.downloadPdf(paperId, { savePath });
        return {
          content: [{
            type: 'text',
            text: `PDF downloaded successfully to: ${filePath}`
          }]
        };
      }

      case 'get_platform_status': {
        const statusInfo = [];
        for (const [platformName, searcher] of Object.entries(currentSearchers)) {
          if (platformName === 'wos' || platformName === 'scholar') continue;
          const capabilities = (searcher as PaperSource).getCapabilities();
          const hasApiKey = (searcher as PaperSource).hasApiKey();
          let apiKeyStatus = 'not_required';
          if (capabilities.requiresApiKey) {
            if (hasApiKey) {
              const isValid = await (searcher as PaperSource).validateApiKey();
              apiKeyStatus = isValid ? 'valid' : 'invalid';
            } else {
              apiKeyStatus = 'missing';
            }
          }
          statusInfo.push({
            platform: platformName,
            baseUrl: (searcher as PaperSource).getBaseUrl(),
            capabilities,
            apiKeyStatus
          });
        }
        return {
          content: [{
            type: 'text',
            text: `Platform Status:\n\n${JSON.stringify(statusInfo, null, 2)}`
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    success = false;
    errorMessage = error.message;
    debugLog(`Error in tool ${name}:`, error);
    logError(error, { tool: name, arguments: args });
    return {
      content: [{
        type: 'text',
        text: `Error executing tool '${name}': ${error.message || 'Unknown error'}`
      }],
      isError: true
    };
  } finally {
    const duration = Date.now() - startTime;
    logToolResponse(name, success, duration, errorMessage);
  }
});

/**
 * 메인 서버 시작 함수
 */
async function main() {
  try {
    const PORT = parseInt(process.env.PORT || '3000', 10);
    const HOST = process.env.HOST || '0.0.0.0';

    console.log('🚀 Starting Paper Search MCP Server...');
    console.log(`📦 Node.js version: ${process.version}`);
    console.log(`📍 Working directory: ${process.cwd()}`);

    // StreamableHTTPServerTransport 생성
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    });

    // MCP 서버를 transport에 연결
    await server.connect(transport);
    debugLog('✅ MCP Server connected to StreamableHTTPServerTransport');

    // HTTP 서버 생성
    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);

      // CORS 헤더
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'X-Session-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 헬스 체크 엔드포인트
      if (url.pathname === '/health' && req.method === 'GET') {
        logAccess(req.method, url.pathname);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          name: 'paper-search-mcp-nodejs',
          version: '0.3.0',
          transport: 'StreamableHTTP'
        }));
        return;
      }

      // MCP 엔드포인트 - StreamableHTTPServerTransport에 위임
      if (url.pathname === '/mcp' || url.pathname === '/') {
        try {
          await transport.handleRequest(req, res);
          logAccess(req.method || 'UNKNOWN', url.pathname, undefined, res.statusCode);
        } catch (error: any) {
          debugLog('Error handling request:', error);
          logError(error, { method: req.method, path: url.pathname });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        }
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    // HTTP 서버 시작
    httpServer.listen(PORT, HOST, () => {
      console.log('✅ Paper Search MCP Server is running!');
      console.log(`🌐 Server: http://${HOST}:${PORT}`);
      console.log(`📡 MCP endpoint: http://${HOST}:${PORT}/mcp`);
      console.log(`❤️  Health check: http://${HOST}:${PORT}/health`);
      console.log(`📝 Logs: ./logs`);
      logInfo('Server started', { host: HOST, port: PORT });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    logError(error as Error, { context: 'server startup' });
    process.exit(1);
  }
}

// 에러 핸들링
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  logError(error, { type: 'uncaughtException' });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  logError(reason as Error, { type: 'unhandledRejection' });
  process.exit(1);
});

// 서버 시작
main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  logError(error, { context: 'main function' });
  process.exit(1);
});
