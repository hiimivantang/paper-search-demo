# Session Context

## User Prompts

### Prompt 1

Base directory for this skill: /Users/ivantang/.claude/plugins/cache/ralph-marketplace/ralph-skills/1.0.0/skills/prd

# PRD Generator

Create detailed Product Requirements Documents that are clear, actionable, and suitable for implementation.

---

## The Job

1. Receive a feature description from the user
2. Ask 3-5 essential clarifying questions (with lettered options)
3. Generate a structured PRD based on answers
4. Save to `tasks/prd-[feature-name].md`

**Important:** Do NOT start implementi...

### Prompt 2

1A, 2C, 3A, 4C, 5C. Ensure you don't break my collection / schema / backend.

### Prompt 3

Load the ralph skill and convert tasks/prd-[feature-name].md to prd.json

### Prompt 4

Base directory for this skill: /Users/ivantang/.claude/plugins/cache/ralph-marketplace/ralph-skills/1.0.0/skills/ralph

# Ralph PRD Converter

Converts existing PRDs to the prd.json format that Ralph uses for autonomous execution.

---

## The Job

Take a PRD (markdown file or text) and convert it to `prd.json` in your ralph directory.

---

## Output Format

```json
{
  "project": "[Project Name]",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "[Feature description from PR...

