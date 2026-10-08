# ChatGPT project continuity

Read the root `handoff.md` first, then `chatGPT/CHECKLIST_PLAN.md`, `chatGPT/CHECKLIST_CONTENT_HE.md`, and `chatGPT/CODEBASE_FINDINGS.md`.

This folder records ChatGPT's research, decisions, and verification so Claude and future ChatGPT sessions can continue without relying on chat history. Update the root handoff after every work session. Keep application behavior and deployed state separate from proposals. Never store credentials, employee PINs, or personal staff data here.

Current state: the earlier checklist slice is live. The 2026-10-08 employee onboarding, private records/payslips, request-first fair scheduling, categorized native-style dashboards and opaque PIN event access are implemented and verified locally, but are not deployed. Read `docs/STAFF_ONBOARDING.md`, `docs/STAFF_RECORDS.md`, `docs/STAFF_SCHEDULING.md` and root `handoff.md` for the exact release state. `chatGPT/MOBILE_APP_ROADMAP.md` covers the future Android/iOS track.

Confirmed requirements: employee number matched manually to HYP; number/code first login without email or Google; optional later Google/email linking; owner manual or random code choice; dedicated in-app checklist inbox with prominent gap signal.
