# Lessons

## Avoid PowerShell For Development Work

PowerShell is not a safe default shell for this project environment.

We observed repeated Korean encoding problems in terminal output and source-related workflows. This can hide the real issue, corrupt readable messages, and create misleading debugging trails. It also makes long one-line processing scripts difficult to trust.

Going forward:

- Do not use PowerShell for normal development automation.
- Do not use PowerShell for image processing or asset pipeline work.
- Do not pipe Korean text through PowerShell during debugging.
- Prefer project scripts, checked-in utility scripts, or direct file edits.
- If a shell command is unavoidable, keep it minimal and avoid Korean text in command input or output.

This is especially important for this project because server messages, UI labels, and documentation include Korean text.
