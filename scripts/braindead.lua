-- Integracja z BrainDeadem.
--
-- Rozmawiamy Z APLIKACJĄ przez gniazdo uniksowe, bezpośrednio z Lua (vim.uv = libuv).
-- Celowo BEZ wołania zewnętrznego `braindead` z PATH: Neovide odpalone z Docka dostaje
-- okrojony PATH i taka droga potrafi po cichu nie zadziałać. Gniazdo działa tak samo
-- w Neovimie w panelu BrainDeada i w samodzielnym Neovide.
local uv = vim.uv or vim.loop

local M = {}

local KANDYDACI = {
  "~/Library/Application Support/com.vibecoder.app/braindead.sock",
  "~/.local/share/com.vibecoder.app/braindead.sock",
  "~/.config/com.vibecoder.app/braindead.sock",
}

--- Ścieżka do gniazda działającej aplikacji albo nil, gdy BrainDead nie chodzi.
function M.gniazdo()
  for _, p in ipairs(KANDYDACI) do
    local sciezka = vim.fn.expand(p)
    if vim.fn.getftype(sciezka) == "socket" then
      return sciezka
    end
  end
  return nil
end

--- Wysyła komendę. Zwraca false, gdy aplikacja nie działa (wtedy NIE przejmujemy akcji).
function M.send(verb, arg)
  local sciezka = M.gniazdo()
  if not sciezka then
    return false
  end
  local pipe = uv.new_pipe(false)
  pipe:connect(sciezka, function(err)
    if err then
      pipe:close()
      return
    end
    pipe:write(verb .. "\t" .. (arg or "") .. "\n", function()
      pipe:close()
    end)
  end)
  return true
end

--- Otwiera plik w viewerze BrainDeada.
function M.open(sciezka)
  return M.send("open", vim.fn.fnamemodify(sciezka, ":p"))
end

--- Odpala komendę w NOWEJ przestrzeni roboczej BrainDeada (zamiast splita z terminalem).
function M.run(komenda)
  if komenda == nil or komenda == "" then
    return false
  end
  if not M.send("run", komenda) then
    vim.notify("BrainDead nie działa — komenda nieodpalona", vim.log.levels.WARN)
    return false
  end
  return true
end

-- Pliki, których Neovim i tak sensownie nie pokaże, otwieramy w BrainDeadzie.
-- BufReadCmd przejmuje wczytanie, więc binarka nie ląduje w buforze.
-- Gdy aplikacja nie działa, NIE przejmujemy niczego — Neovim zachowa się jak zwykle.
local grupa = vim.api.nvim_create_augroup("BrainDeadOpen", { clear = true })
vim.api.nvim_create_autocmd("BufReadCmd", {
  group = grupa,
  pattern = { "*.pdf", "*.docx", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.bmp", "*.svg" },
  callback = function(ev)
    if not M.open(ev.file) then
      return false -- BrainDead nie działa: niech Neovim robi swoje
    end
    vim.schedule(function()
      pcall(vim.api.nvim_buf_delete, ev.buf, { force = true })
      vim.notify("Otwarte w BrainDeadzie: " .. vim.fn.fnamemodify(ev.file, ":t"))
    end)
    return true
  end,
})

-- Zamiast dzielić okno na terminal — odpal w nowej przestrzeni BrainDeada.
vim.keymap.set("n", "<leader>br", function()
  M.run(vim.fn.input("BrainDead — komenda: "))
end, { desc = "Komenda w nowej przestrzeni BrainDeada" })

vim.keymap.set("n", "<leader>bo", function()
  M.open(vim.fn.expand("%:p"))
end, { desc = "Bieżący plik w viewerze BrainDeada" })

-- :BrainDead run npm test   |   :BrainDead open ~/plik.pdf
vim.api.nvim_create_user_command("BrainDead", function(opts)
  local verb = opts.fargs[1]
  local arg = table.concat(vim.list_slice(opts.fargs, 2), " ")
  if verb == "open" then
    M.open(arg ~= "" and arg or vim.fn.expand("%:p"))
  elseif verb == "run" then
    M.run(arg)
  else
    vim.notify("użycie: :BrainDead open <plik> | :BrainDead run <komenda>", vim.log.levels.WARN)
  end
end, { nargs = "+", complete = "file" })

return M
