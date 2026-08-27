// Rejestr terminalowych agentów AI obsługiwanych w trybie „Agents" (5. tryb panelu). Każde
// narzędzie wie, jaką komendą się je odpala, którą zmienną środowiskową izolować jego config
// (osobny folder na konto) i jaki ma env na klucz API.
// Antigravity/Cursor/Windsurf to IDE, nie CLI — celowo poza listą.
//
// JEDNO ŹRÓDŁO PRAWDY: agents.json. Ten plik tylko go typuje, a strona Rusta generuje
// z niego swoją tablicę w build.rs (src-tauri/build.rs -> OUT_DIR/agent_tools.rs).
// Wcześniej rejestr istniał w trzech kopiach (master TS, Tauri TS, agents.rs) i zdążył
// się rozjechać — master miał Amazon Q bez instalatorów goose/opencode, Tauri odwrotnie.
import raw from './agents.json'

export interface AgentTool {
  id: string
  name: string
  cmd: string // komenda CLI (do uruchomienia w panelu i do wykrywania na PATH)
  configEnv?: string // zmienna izolująca katalog configu (np. CLAUDE_CONFIG_DIR, CODEX_HOME)
  apiKeyEnv?: string // zmienna z kluczem API (gdy profil typu „api")
  install?: { sh?: string; ps?: string } // komenda instalacji (posix / Windows); brak = ręcznie
  authNote: string // krótka podpowiedź jak się autoryzuje
}

export const AGENT_TOOLS: AgentTool[] = raw

export type AgentToolId = string

export function agentTool(id: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.id === id)
}
