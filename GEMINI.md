# Project Instructions: YouTube Algorithm Share

## Tech Stack
- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, Lucide React, Shadcn UI.
- **Backend:** Next.js API Routes, Prisma (PostgreSQL / Supabase), NextAuth v5.
- **Cache:** In-memory Cache Store with Upstash Redis support.

## Authentication & Authorization
- **Auth Provider:** Google OAuth 2.0 & Credentials (Email/Password).
- **Auth Flow:** 
  - **1-Step Integration:** Google login requests broad permissions immediately.
  - **Guest vs Member:**
    - **Guest:** Transient users (Takeout JSON uploaders) without a session.
    - **Member:** Any logged-in user (Google OAuth or Email/Password). Full access to sharing and comparison.
  - **Identity:** Assigned unique IDs internally, displayed as **"당신"** (You) for owners, or actual names/Guest IDs for public profiles.

## Sync & Profiler Logic
- **Sync:** Auto-sync via YouTube API v3. Enforced 5-minute cooldown (429 rate limit).
- **Takeout (Frictionless):** No login required for analysis via `/takeout`.
  - **Privacy:** Anonymous profiles are **Private by Default**.
  - **Ownership:** Cookie-based verification allows anonymous uploaders to view their own private results.
- **Quota Management:** API sync is currently **RESTRICTED**; Takeout is the primary recommended analysis route.

## Recent Improvements (2026-05-26)
- **Member Status Unified:** Google-authenticated users are now treated as full Members (unlocked Compare/Visibility).
- **Name Display Logic:** Public profiles now show actual names/Guest IDs consistently across Explore and Profile pages.
- **Database Transition:** Switched Prisma provider to PostgreSQL (Supabase).
- **Auth Robustness:** Improved `signIn` callback to handle identity collisions and automatic account linking more safely.

## TODO & Future Goals
- **Deployment:** Update `.env` with Supabase password and push the schema (`npx prisma db push`).
- **Git Push:** Manually push changes to `https://github.com/1oneSkad1/JJKC.git`.
- **ZIP Support:** Implement `jszip` to allow direct uploads of compressed Takeout files.
- **API Optimization:** Refine data fetching to further minimize quota consumption.

## Development Workflows
- Always run `npm run typecheck` before finalizing changes.
- Sync API handles `quota_exceeded` (429) specifically.
- Database: Ensure `DATABASE_URL` and `DIRECT_URL` are set with Supabase credentials.
