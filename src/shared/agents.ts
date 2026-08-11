// Rejestr terminalowych agentów AI obsługiwanych w trybie „Agents" (5. tryb panelu). Każde
// narzędzie wie, jaką komendą się je odpala, którą zmienną środowiskową izolować jego config
// (osobny folder na konto) i jaki ma env na klucz API. Współdzielony przez main (PTY/instalacja)
// i renderer (UI). Antigravity/Cursor/Windsurf to IDE, nie CLI — celowo poza listą.

export type AgentToolId = 'claude' | 'gemini' | 'codex' | 'kimi' | 'aider' | 'goose' | 'opencode' | 'q'

export interface AgentTool {
  id: AgentToolId
  name: string
  cmd: string // komenda CLI (do uruchomienia w panelu i do wykrywania na PATH)
  configEnv?: string // zmienna izolująca katalog configu (np. CLAUDE_CONFIG_DIR, CODEX_HOME)
  apiKeyEnv?: string // zmienna z kluczem API (gdy profil typu „api")
  install?: { sh?: string; ps?: string } // komenda instalacji (posix / Windows); brak = instaluj ręcznie
  authNote: string // krótka podpowiedź jak się autoryzuje
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    cmd: 'claude',
    configEnv: 'CLAUDE_CONFIG_DIR',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    install: { sh: 'curl -fsSL https://claude.ai/install.sh | bash', ps: 'irm https://claude.ai/install.ps1 | iex' },
    authNote: '/login (OAuth) or ANTHROPIC_API_KEY'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    cmd: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    install: { sh: 'npm install -g @google/gemini-cli', ps: 'npm install -g @google/gemini-cli' },
    authNote: 'Google login or GEMINI_API_KEY'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    cmd: 'codex',
    configEnv: 'CODEX_HOME',
    apiKeyEnv: 'OPENAI_API_KEY',
    install: { sh: 'npm install -g @openai/codex', ps: 'npm install -g @openai/codex' },
    authNote: 'ChatGPT login or OPENAI_API_KEY'
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    cmd: 'kimi',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    install: {
      sh: 'curl -LsSf https://code.kimi.com/install.sh | bash',
      ps: 'irm https://code.kimi.com/install.ps1 | iex'
    },
    authNote: '/login (OAuth) or MOONSHOT_API_KEY'
  },
  {
    id: 'aider',
    name: 'Aider',
    cmd: 'aider',
    apiKeyEnv: 'OPENAI_API_KEY',
    install: { sh: 'python3 -m pip install -U aider-chat' },
    authNote: 'API key (OpenAI/Anthropic/…) via env'
  },
  {
    id: 'goose',
    name: 'Goose',
    cmd: 'goose',
    authNote: 'goose configure'
  },
  {
    id: 'opencode',
    name: 'opencode',
    cmd: 'opencode',
    authNote: 'opencode auth login'
  },
  {
    id: 'q',
    name: 'Amazon Q',
    cmd: 'q',
    authNote: 'q login'
  }
]

export function agentTool(id: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.id === id)
}
