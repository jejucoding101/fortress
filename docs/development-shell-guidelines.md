# Development Shell Guidelines

## Avoid PowerShell During Development

PowerShell should not be used as the default development shell for this project.

Reason:

- Korean text can be corrupted during input and output in this environment.
- Encoding issues can make logs, source snippets, and error messages unreliable.
- Broken Korean strings have already caused confusion while debugging server and client behavior.
- PowerShell one-liners for image or file processing are hard to verify and easy to break in this workspace.

Preferred approach:

- Use project-native scripts such as `npm run build` and `npm run dev` from a stable terminal environment.
- Prefer code changes through repository files rather than large shell one-liners.
- For asset processing, use checked-in scripts or small project tools instead of ad hoc PowerShell commands.
- If shell work is unavoidable, keep commands simple and avoid Korean text input/output through the shell.
- Do not pass Korean absolute paths directly to `cmd.exe`; use the checked-in Unicode path helper instead.

## Korean Path Workaround

Some Windows commands corrupt Korean path segments before the target program receives them. In this workspace,
paths such as the user profile directory can become unreadable when written directly in a command string or expanded
through `%USERPROFILE%`.

Use the Node-based helper when a command needs to read files below a Korean path:

```bat
node scripts\unicode-path.mjs exists codex-skill game-studio 0.1.2 skills phaser-2d-game SKILL.md
node scripts\unicode-path.mjs print codex-skill game-studio 0.1.2 skills phaser-2d-game SKILL.md
node scripts\unicode-path.mjs list codex-skill game-studio 0.1.2 skills
```

The command arguments stay ASCII-only, and the helper resolves Unicode paths internally through Node's filesystem APIs.

Practical rule:

Do not rely on PowerShell for development automation, asset processing, or debugging workflows in this project unless there is no safer alternative. When Korean path access is required, use `scripts/unicode-path.mjs`.
