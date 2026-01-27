# Contributing to Moxie 🤖

Thanks for your interest in contributing to **Moxie**!  
Moxie is a modular, self-hosted Discord bot built as an open-source alternative to all-in-one bots like MEE6.

Contributions of all kinds are welcome — code, ideas, documentation, and feedback.

---

## 🧭 Project Philosophy

Before contributing, please keep these core principles in mind:

- **Open source first** — no paid features or paywalls
- **Self-hosted friendly** — contributors should be able to run everything locally
- **Modular design** — features should be opt-in and isolated when possible
- **Respectful collaboration** — constructive, kind communication is expected

---

## 🛠️ Ways to Contribute

You don’t need to write code to help!

### 💡 Ideas & Feedback
- Open a **Discussion** for feature ideas or design questions
- Use **Issues** for concrete, actionable bugs

### 🐛 Bug Reports
When reporting a bug, please include:
- What you expected to happen
- What actually happened
- Steps to reproduce (if possible)
- Node.js version and OS

### 🧪 Code Contributions
Code contributions are welcome for:
- Bug fixes
- New modular features
- Documentation improvements
- Internal refactors (please discuss larger ones first)

---

## 🌿 Branching & Workflow

Moxie uses a simple branching model:

- **`main`** → stable, released code
- **`dev`** → active development

### Please follow these rules:
- ✅ Open pull requests **against `dev`**
- ❌ Do not open PRs directly against `main`
- 🔹 Keep PRs focused (one feature or fix per PR)
- 💬 Discuss large changes in Discussions before coding

---

## 🧑‍💻 Development Setup

Basic setup steps:

```bash
npm install
cp .env.example .env
npm run deploy
npm run dev
