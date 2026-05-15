# Hackathon Context — Transforming Enterprise Through AI

Source: <https://lablab.ai/ai-hackathons/techex-intelligent-enterprise-solutions-hackathon>
Host: **lablab.ai** × **TechEx / AI & Big Data Expo North America**
Tagline: *Build AI Agents for Security, Edge & Robotics*

## When & where

- **May 11–19, 2026** — online build phase
- **May 18** — hybrid build day (online + onsite)
- **May 19** — demos & awards (live on stage at AI & Big Data Expo NA)
- Onsite venue: **San Jose McEnery Convention Center, CA**
- Onsite participants get a free AI & Big Data Expo NA ticket

## Tracks (pick one primary)

1. **🔐 Agent Security & AI Governance** — *powered by Veea*
   Guardrails, observability, access control, audit trails, red-teaming for agentic systems.
2. **🤖 AI Agents with Google AI Studio** — *powered by Google DeepMind / AI Studio*
   Gemini-based multi-agent systems, long-context doc processing, dev/ops/internal tools, enterprise integrations.
3. **🤖 Robotics & Simulation**
   Robotics control, simulation envs, digital twins, VLMs for real-world tasks, human-robot collaboration.
4. **📊 Data & Intelligence**
   RAG over proprietary data, AI data pipelines, NL analytics agents, anomaly detection, knowledge-graph extraction.

## Sponsor tech

- **Google Gemini + AI Studio** — free browser IDE for prototyping; free Gemini API tier; $300 / 90-day Google Cloud credits for new accounts. Recommended models: **Gemini Flash** (low latency / real-time agents) or **Gemini Pro** (advanced reasoning).
- **Veea Lobster Trap** (MIT, free) — drop-in **deep prompt inspection (DPI) proxy** between agents and any OpenAI-compatible LLM (Ollama, vLLM, llama.cpp, OpenAI, Anthropic, Gemini). YAML policies with `ALLOW / DENY / LOG / HUMAN_REVIEW / QUARANTINE / RATE_LIMIT`; declared-vs-detected intent inspection via `_lobstertrap` metadata; Go static binary; ships dashboards, audit logs, CLI, and a `./lobstertrap test` adversarial suite. Veea engineers mentor in lablab Discord.

## Prizes — $10,000 pool + Veea rewards

**Gemini Award** (best use of Gemini):
- 🥇 1st: **$5,000**
- 🥈 2nd: **$3,000**
- 🥉 3rd: **$2,000**

**Veea Award** (winner of Track 1 — Agent Security & AI Governance):
- Veea DevKit on **NVIDIA DGX Spark** + TerraFabric pilot access
- Co-authored technical writeup amplified on Veea channels
- Direct intro to Veea engineering (collab / pilot / hiring)
- Stage recognition at AI & Big Data Expo NA (8,000+ attendees)

## Judging criteria

1. **Application of Technology** — how effectively the chosen models are integrated
2. **Presentation** — clarity and effectiveness of the pitch
3. **Business Value** — practical impact, fit to real business areas
4. **Originality** — uniqueness and creativity

## Submission requirements

- Project title + short and long descriptions + tech/category tags
- Cover image, **video presentation**, slide deck
- **Public GitHub repo** (must be original, MIT-compliant)
- Demo application URL + hosting platform

## How this maps to our project

Ad verification system fits **Track 1 (Agent Security & AI Governance)** as primary — it *is* a guardrails / brand-safety / policy-enforcement product. Use **Lobster Trap** as the trust layer between verifier agents (eligible for the Veea Award) and **Gemini** (Flash for the sub-second hot path) for content classification (eligible for the Gemini Award). One submission can plausibly compete for both.
