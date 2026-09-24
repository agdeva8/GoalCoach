# Graph Report - GoalCoach  (2026-09-24)

## Corpus Check
- 156 files · ~60,998 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 22 file(s) not represented in the graph (top: (none) 14, .css 3, .xml 3)

## Summary
- 1206 nodes · 2068 edges · 90 communities (70 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.84)
- Token cost: 14,500 input · 5,200 output

## Community Hubs (Navigation)
- FastAPI Backend Core
- Root Package Dependencies
- Package Resolutions
- Card UI Components
- MongoDB Schema & Domain Model
- Frontend Package Dependencies
- Hover/Popover UI Primitives
- Mongo to Drizzle ETL
- DB Tooling & Drivers
- AlertDialog UI
- Toast UI Components
- ETL Migration Main Loop
- AI SDK Deps (root pkg)
- Iteration 3 Backend Tests
- Chat Console UI
- Auth.js Drizzle Adapter
- Reject Proposal API
- Dev Dependencies (Next.js)
- Backend Pytest Suite
- Command/Combobox UI
- Proposal Executor
- TypeScript Config
- Component Path Aliases
- React App & Auth Routing
- Alert & Badge UI
- Legacy CRA Dev Dependencies
- Menubar UI
- Guest Session Routes
- GET API Routes (audit/history/export)
- App Header & Modals
- Preferences API
- Auth Me API
- NPM Scripts
- Tracking Dashboard UI
- Form UI Components
- AI SDK Deps (frontend pkg)
- Proposal Tool Definitions
- Sonner Toast Integration
- CRACO Build Config
- Guest Auto-Answer Tests
- SSE Chat Orchestration
- SSE Test Flows
- Sources CRUD Tests
- Emergent AI SDK Legacy
- Legacy Backend Stack
- Auth & DB Utilities
- Legacy Integrations
- Carousel UI
- Drawer UI
- Select UI
- Sheet UI
- Toggle UI
- Confirm Proposal API
- Next.js Middleware Routing
- Sources Backend Stack
- Timeline UI
- Breadcrumb UI
- Neon DB Connection
- Health Endpoints
- Webpack Health Plugin
- Honesty Audit View
- Legacy Auth Constants
- Migration DB Tests
- OTP Input UI
- Auth Endpoint Tests
- JSConfig Paths
- Accordion UI
- Avatar UI
- Tabs UI
- Agent Communication Protocol
- CRA NPM Scripts
- ESLint Configuration
- Preferences Tests
- Browser List Targets
- Sample Page Component
- Drizzle Config
- LLM System Prompts
- Aspect Ratio UI
- Collapsible UI
- Vitest Test Setup
- PostCSS Config
- Test Run Job ID
- Placeholder Instructions
- Testing Protocol
- HTTP Method Exports
- pnpm Workspace Allow-Builds

## God Nodes (most connected - your core abstractions)
1. `cn()` - 199 edges
2. `resolutions` - 43 edges
3. `lucide-react` - 31 edges
4. `next` - 26 edges
5. `scripts` - 16 edges
6. `compilerOptions` - 16 edges
7. `users collection (MongoDB, primary key user_id)` - 14 edges
8. `main()` - 13 edges
9. `log()` - 12 edges
10. `applyProposal()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `stripe 14.4.1 (unused in PRD?)` --references--> `GoalCoach (chat-first AI life coach)`  [AMBIGUOUS]
  backend/requirements.txt → memory/PRD.md
- `litellm (emergent internal asset)` --implements--> `Model Switcher (Gemini/Claude/OpenAI, persisted)`  [AMBIGUOUS]
  backend/requirements.txt → memory/PRD.md
- `Next.js Template with shadcn/ui` --semantically_similar_to--> `Create React App (CRA)`  [INFERRED] [semantically similar]
  y/README.md → frontend/README.md
- `Posthog Analytics Init (phc_DbsPb39SRc8z3EiQ6Dhj6ikv4H4rTKcht9d4sZSesceP)` --references--> `GoalCoach (chat-first AI life coach)`  [AMBIGUOUS]
  frontend/public/index.html → memory/PRD.md
- `Emergent Main Script (assets.emergent.sh)` --references--> `GoalCoach (chat-first AI life coach)`  [AMBIGUOUS]
  frontend/public/index.html → memory/PRD.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Authentication Flow (session + endpoints + OAuth)** — auth_testing_emergent_google_oauth, auth_testing_session_token_cookie, auth_testing_api_auth_me, auth_testing_api_state, auth_testing_bearer_header, memory_prd_guest_real_session, memory_prd_stack_choices [EXTRACTED 1.00]
- **LLM Model Switcher (Gemini/Claude/OpenAI)** — memory_prd_model_switcher, backend_requirements_google_genai, backend_requirements_google_generativeai, backend_requirements_openai, backend_requirements_emergentintegrations, backend_requirements_litellm [EXTRACTED 1.00]
- **Backend Stack (FastAPI + MongoDB + Object Storage + PDF)** — memory_prd_server_py, backend_requirements_fastapi, backend_requirements_motor, backend_requirements_boto3, backend_requirements_pypdf [EXTRACTED 1.00]
- **Mongo collections migrated by db/migrate-from-mongo.ts ETL** — migration_discovery_01_mongo_schema_users, migration_discovery_01_mongo_schema_user_sessions, migration_discovery_01_mongo_schema_goals, migration_discovery_01_mongo_schema_commitments, migration_discovery_01_mongo_schema_milestones, migration_discovery_01_mongo_schema_blockers, migration_discovery_01_mongo_schema_messages, migration_discovery_01_mongo_schema_audit_log, migration_discovery_01_mongo_schema_sources [EXTRACTED 1.00]
- **Phase 1 locked architecture decisions (2026-09-24)** — migration_discovery_03_nextjs_architecture_nextjs_16_scaffold, migration_discovery_03_nextjs_architecture_vercel_blob, migration_discovery_03_nextjs_architecture_subdomain_strategy [EXTRACTED 1.00]
- **Mongo collections sharing user_id FK to users** — migration_discovery_01_mongo_schema_user_sessions, migration_discovery_01_mongo_schema_goals, migration_discovery_01_mongo_schema_commitments, migration_discovery_01_mongo_schema_milestones, migration_discovery_01_mongo_schema_blockers, migration_discovery_01_mongo_schema_messages, migration_discovery_01_mongo_schema_audit_log, migration_discovery_01_mongo_schema_sources [EXTRACTED 1.00]

## Communities (90 total, 20 thin omitted)

### Community 0 - "FastAPI Backend Core"
Cohesion: 0.06
Nodes (69): add_link(), apply_proposal(), auth_me(), BlockerIn, build_context(), chat_history(), chat_stream(), gen() (+61 more)

### Community 1 - "Root Package Dependencies"
Cohesion: 0.04
Nodes (57): dependencies, axios, class-variance-authority, clsx, cmdk, cra-template, date-fns, dayjs (+49 more)

### Community 2 - "Package Resolutions"
Cohesion: 0.05
Nodes (43): resolutions, **/anymatch/picomatch, **/axios/form-data, @babel/plugin-transform-modules-systemjs, **/cosmiconfig/yaml, **/css-loader/postcss, **/css-minimizer-webpack-plugin/postcss, **/cssnano/yaml (+35 more)

### Community 3 - "Card UI Components"
Cohesion: 0.08
Nodes (38): Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, ContextMenuCheckboxItem, ContextMenuContent (+30 more)

### Community 4 - "MongoDB Schema & Domain Model"
Cohesion: 0.14
Nodes (36): graphify usage rules (project CLAUDE.md), audit_log collection (event type, summary, payload), blockers collection (title, start_date, end_date, note), commitments collection (text, due, status), goals collection (horizon, status, target_date), guest-to-account user_id reassignment (in-app migration), messages collection (chat history + proposals), milestones collection (target_date, status) (+28 more)

### Community 5 - "Frontend Package Dependencies"
Cohesion: 0.06
Nodes (35): dotenv, eslint, next-themes, react, react-dom, tailwindcss, zod, name (+27 more)

### Community 6 - "Hover/Popover UI Primitives"
Cohesion: 0.06
Nodes (22): HoverCardContent, Input, PopoverContent, Progress, ScrollArea, ScrollBar, Separator, Skeleton() (+14 more)

### Community 7 - "Mongo to Drizzle ETL"
Cohesion: 0.12
Nodes (26): drizzle-orm, downloadFromEmergent(), getEmergentKey(), MessagesStats, MigrateStats, MongoDoc, auditLog, blockers (+18 more)

### Community 8 - "DB Tooling & Drivers"
Cohesion: 0.07
Nodes (27): drizzle-zod, jsdom, mongodb, prettier, prettier-plugin-tailwindcss, @tailwindcss/postcss, @testing-library/react, tsx (+19 more)

### Community 9 - "AlertDialog UI"
Cohesion: 0.11
Nodes (21): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+13 more)

### Community 10 - "Toast UI Components"
Cohesion: 0.15
Nodes (20): Toast, ToastAction, ToastClose, ToastDescription, frontend_src_components_ui_toast_toastprovider, ToastTitle, toastVariants, ToastViewport (+12 more)

### Community 11 - "ETL Migration Main Loop"
Cohesion: 0.23
Nodes (23): ensureStateTable(), fail(), flushBatch(), loadMigratedIds(), log(), main(), migrateAuditLog(), migrateBlockers() (+15 more)

### Community 12 - "AI SDK Deps (root pkg)"
Cohesion: 0.09
Nodes (22): dependencies, ai, @ai-sdk/anthropic, @ai-sdk/google, @ai-sdk/openai, @ai-sdk/openai-compatible, @auth/drizzle-adapter, dotenv (+14 more)

### Community 13 - "Iteration 3 Backend Tests"
Cohesion: 0.11
Nodes (9): Iteration 3 tests: guest sessions, blockers CRUD, sources…, _read_sse(), TestAuthSessionEndpoint, TestBlockers, TestGuest, TestGuestChatWithSource, TestGuestSources, TestStateSources (+1 more)

### Community 14 - "Chat Console UI"
Cohesion: 0.13
Nodes (13): ActionPromptModal(), FRAMES, ChatConsole(), ACTION_LABELS, HORIZON_LABELS, ToolConfirmationPrompt(), Checkbox, RadioGroup (+5 more)

### Community 15 - "Auth.js Drizzle Adapter"
Cohesion: 0.12
Nodes (16): @auth/drizzle-adapter, next-auth, server-only, ref_zod, accounts, sessions, verificationTokens, AppJWT (+8 more)

### Community 16 - "Reject Proposal API"
Cohesion: 0.17
Nodes (15): authenticate(), POST(), rejectInDb(), rejectInMemory(), confirmedProposals, getProposal(), isRejected(), markConfirmed() (+7 more)

### Community 17 - "Dev Dependencies (Next.js)"
Cohesion: 0.10
Nodes (20): devDependencies, drizzle-kit, eslint, eslint-config-next, jsdom, prettier, prettier-plugin-tailwindcss, tailwindcss (+12 more)

### Community 18 - "Backend Pytest Suite"
Cohesion: 0.12
Nodes (14): cleanup_before_tests(), client(), GoalCoach backend API tests (pytest). Covers auth, state, chat streaming (SSE),…, Wipe test user's goals/commitments/messages/audit before running so state is…, TestOverCommitment, TestState, Iteration 2 tests: guest_stream (no auth), auto_answer flag,…, TestStateShapeV2 (+6 more)

### Community 19 - "Command/Combobox UI"
Cohesion: 0.11
Nodes (16): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut() (+8 more)

### Community 20 - "Proposal Executor"
Cohesion: 0.22
Nodes (18): applyAddBlocker(), applyAddCommitment(), applyAddMilestone(), applyCompleteCommitment(), applyCreateGoal(), applyProposal(), ApplyProposalResult, applySetGoalDates() (+10 more)

### Community 21 - "TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 22 - "Component Path Aliases"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 23 - "React App & Auth Routing"
Cohesion: 0.18
Nodes (12): App(), AuthCallback(), AuthContext, AuthProvider(), useAuth(), queryClient, root, Coach() (+4 more)

### Community 24 - "Alert & Badge UI"
Cohesion: 0.13
Nodes (15): Alert, AlertDescription, AlertTitle, alertVariants, Badge(), badgeVariants, NavigationMenu, NavigationMenuContent (+7 more)

### Community 25 - "Legacy CRA Dev Dependencies"
Cohesion: 0.12
Nodes (17): devDependencies, autoprefixer, @babel/plugin-proposal-private-property-in-object, @craco/craco, dotenv, @emergentbase/overlay, @emergentbase/visual-edits, eslint (+9 more)

### Community 26 - "Menubar UI"
Cohesion: 0.12
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 27 - "Guest Session Routes"
Cohesion: 0.25
Nodes (14): ref_node_crypto, dynamic, POST(), runtime, db, b64urlDecode(), b64urlEncode(), generateGuestUserId() (+6 more)

### Community 28 - "GET API Routes (audit/history/export)"
Cohesion: 0.15
Nodes (7): GET(), GET(), GET(), dynamic, mockSSEStream(), POST(), runtime

### Community 29 - "App Header & Modals"
Cohesion: 0.20
Nodes (9): AboutModal(), FOUNDER, UPCOMING, Header(), PROVIDERS, STORYBOARDS, Logo(), OnboardingBanner() (+1 more)

### Community 30 - "Preferences API"
Cohesion: 0.17
Nodes (6): next, PUT(), VALID_PROVIDERS, POST(), POST(), nextConfig

### Community 31 - "Auth Me API"
Cohesion: 0.17
Nodes (11): dynamic, GET(), runtime, mockAuth, mockSelectImpl, signInWithGoogle(), signOutAction(), auth (+3 more)

### Community 32 - "NPM Scripts"
Cohesion: 0.12
Nodes (16): scripts, build, db:generate, db:migrate, db:push, db:studio, dev, format (+8 more)

### Community 33 - "Tracking Dashboard UI"
Cohesion: 0.15
Nodes (11): AREAS, HORIZON_LABELS, HORIZON_ORDER, LEVEL_STYLES, mileColor(), MilestonesChip(), SourcesChip(), STATUS_ICON (+3 more)

### Community 34 - "Form UI Components"
Cohesion: 0.19
Nodes (12): FormControl, FormDescription, FormFieldContext, FormItem, FormItemContext, FormLabel, FormMessage, useFormField() (+4 more)

### Community 35 - "AI SDK Deps (frontend pkg)"
Cohesion: 0.18
Nodes (12): ai, @ai-sdk/anthropic, @ai-sdk/google, @ai-sdk/openai, @ai-sdk/openai-compatible, MODEL_OPTIONS, MODEL_REGISTRY, ModelEntry (+4 more)

### Community 36 - "Proposal Tool Definitions"
Cohesion: 0.13
Nodes (14): add_blocker, add_commitment, add_milestone, complete_commitment, create_goal, drop_goal, GoalStatusSchema, HorizonSchema (+6 more)

### Community 37 - "Sonner Toast Integration"
Cohesion: 0.16
Nodes (9): ref_next_themes, sonner, y_app_globals, fontMono, fontSans, isTypingTarget(), ThemeHotkey(), onKeyDown() (+1 more)

### Community 38 - "CRACO Build Config"
Cohesion: 0.17
Nodes (7): config, path, webpackConfig, @emergentbase/visual-edits, ref_path, vitest, GET()

### Community 39 - "Guest Auto-Answer Tests"
Cohesion: 0.17
Nodes (5): With auto_answer=True the guest LLM should skip clarifying and propose., Even without cookies/bearer, guest_stream should work., _read_sse(), TestAutoAnswerFlow, TestGuestChat

### Community 40 - "SSE Chat Orchestration"
Cohesion: 0.20
Nodes (11): /api/auth/me endpoint, /api/state endpoint, Backlog P1: transcript trim, stricter goal disambiguation, Coach.js (frontend SSE orchestrator), Drill-Down Timeline (year->quarter->month->week with drift line), Honesty Audit Log + JSON Export, Memory = Durable State (goals/commitments injected each turn), Over-Commitment Indicator (computed truth) (+3 more)

### Community 41 - "SSE Test Flows"
Cohesion: 0.18
Nodes (4): Integration flow: send message -> stream -> tools -> confirm -> state updates…, Parse an SSE response into list of json events., _read_sse(), TestChatFlow

### Community 43 - "Emergent AI SDK Legacy"
Cohesion: 0.20
Nodes (10): emergentintegrations 0.2.1 (Emergent Universal Key), google-genai 2.25.0 (Gemini SDK), google-generativeai 0.8.6, litellm (emergent internal asset), openai 1.99.9, Clarifying-Questions Mode + auto_answer flag, Coach System Prompt (6 response shapes, [[TOOLS]] proposal protocol), Model Switcher (Gemini/Claude/OpenAI, persisted) (+2 more)

### Community 44 - "Legacy Backend Stack"
Cohesion: 0.33
Nodes (9): env_image_name: fastapi_react_mongo_shadcn_base_image_cloud_arm, fastapi 0.110.1, motor 3.3.1 (async MongoDB driver), CRA Scripts (npm start/test/build/eject), Create React App (CRA), Stack Choices (CRA/Tailwind/shadcn/FastAPI/MongoDB/Emergent OAuth), Next.js Agent Rules (this is NOT the Next.js you know), Next.js Template with shadcn/ui (+1 more)

### Community 45 - "Auth & DB Utilities"
Cohesion: 0.25
Nodes (9): Authorization: Bearer header, Browser Cookie Setup (Playwright), Emergent Google OAuth, MongoDB _id exclusion ({_id: 0}), Auth-Gated App Testing Playbook, Session Token (7-day expires_at), Test User & Session Creation (mongosh), Guest Preview (landing at /, ephemeral chat via /api/chat/guest_stream) (+1 more)

### Community 46 - "Legacy Integrations"
Cohesion: 0.22
Nodes (9): stripe 14.4.1 (unused in PRD?), Emergent Main Script (assets.emergent.sh), Inter Font (weight 600), PerformanceServerTiming DataCloneError patch, Posthog Analytics Init (phc_DbsPb39SRc8z3EiQ6Dhj6ikv4H4rTKcht9d4sZSesceP), Action Chips in Dashboard (LLM stays only writer), Core Requirements (chat surface, LLM-only-writer, cross-horizon wedge, persistence, v1 scope), Founder Persona (User #1: self-directed IC) (+1 more)

### Community 47 - "Carousel UI"
Cohesion: 0.33
Nodes (8): Carousel, CarouselContent, CarouselContext, CarouselItem, CarouselNext, CarouselPrevious, useCarousel(), embla-carousel-react

### Community 48 - "Drawer UI"
Cohesion: 0.22
Nodes (7): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle, vaul

### Community 49 - "Select UI"
Cohesion: 0.22
Nodes (8): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, @radix-ui/react-select

### Community 50 - "Sheet UI"
Cohesion: 0.25
Nodes (8): SheetContent, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle, sheetVariants, @radix-ui/react-dialog

### Community 51 - "Toggle UI"
Cohesion: 0.31
Nodes (7): ToggleGroup, ToggleGroupContext, ToggleGroupItem, Toggle, toggleVariants, @radix-ui/react-toggle, @radix-ui/react-toggle-group

### Community 52 - "Confirm Proposal API"
Cohesion: 0.39
Nodes (6): authenticate(), confirmInDb(), confirmInMemory(), POST(), stubState(), isConfirmed()

### Community 53 - "Next.js Middleware Routing"
Cohesion: 0.31
Nodes (8): config, isCoachPath(), isPublic(), isStaticAsset(), middleware(), PUBLIC_EXACT, PUBLIC_PREFIXES, runtime

### Community 54 - "Sources Backend Stack"
Cohesion: 0.25
Nodes (8): boto3 1.43.99 (S3 / Emergent Object Storage), pypdf 6.19.0 (PDF text extraction), Blockers CRUD Endpoints (/api/blockers), File & Link Sources via Emergent Object Storage (20MB cap, extension allowlist, PDF/MD/TXT extraction), Iteration 3 Verified (21/21 backend + frontend flows, iteration_3.json), Milestones RAG Chip (green/amber/red), Next: Calendar View + Editable Daily Timetable + In-Calendar Blocker CRUD, Planner Tools (set_goal_dates, add_milestone, add_blocker)

### Community 55 - "Timeline UI"
Cohesion: 0.46
Nodes (7): DOW, fmtDay(), makeBuckets(), MONTHS, parse(), startOfWeek(), Timeline()

### Community 56 - "Breadcrumb UI"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 57 - "Neon DB Connection"
Cohesion: 0.29
Nodes (7): @neondatabase/serverless, pg, ws, buildDb(), built, dbDriver, resolveDriver()

### Community 58 - "Health Endpoints"
Cohesion: 0.38
Nodes (6): formatBytes(), formatDuration(), os, SERVER_START_TIME, setupHealthEndpoints(), ref_os

### Community 60 - "Honesty Audit View"
Cohesion: 0.48
Nodes (4): fmt(), HonestyAuditView(), api, exportUrl()

### Community 61 - "Legacy Auth Constants"
Cohesion: 0.29
Nodes (4): LOGIN, LOGOUT, REGISTER, HOME

### Community 62 - "Migration DB Tests"
Cohesion: 0.33
Nodes (4): Direct DB test of guest -> account migration branch in POST /api/auth/session.…, os, pymongo, uuid

### Community 63 - "OTP Input UI"
Cohesion: 0.33
Nodes (5): InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot, input-otp

### Community 65 - "JSConfig Paths"
Cohesion: 0.40
Nodes (4): compilerOptions, baseUrl, paths, include

### Community 66 - "Accordion UI"
Cohesion: 0.40
Nodes (4): AccordionContent, AccordionItem, AccordionTrigger, @radix-ui/react-accordion

### Community 67 - "Avatar UI"
Cohesion: 0.40
Nodes (4): Avatar, AvatarFallback, AvatarImage, @radix-ui/react-avatar

### Community 68 - "Tabs UI"
Cohesion: 0.40
Nodes (4): TabsContent, TabsList, TabsTrigger, @radix-ui/react-tabs

### Community 69 - "Agent Communication Protocol"
Cohesion: 0.40
Nodes (5): agent_communication log, Communication Protocol (main <-> testing agent), Task Schema (working/stuck_count/needs_retesting), test_plan (current_focus/stuck_tasks/priority), Testing Data YAML Structure

### Community 70 - "CRA NPM Scripts"
Cohesion: 0.50
Nodes (4): scripts, build, start, test

### Community 71 - "ESLint Configuration"
Cohesion: 0.50
Nodes (3): ref_eslint, eslint-config-next, eslintConfig

### Community 73 - "Browser List Targets"
Cohesion: 0.67
Nodes (3): browserslist, development, production

## Ambiguous Edges - Review These
- `stripe 14.4.1 (unused in PRD?)` → `GoalCoach (chat-first AI life coach)`  [AMBIGUOUS]
  backend/requirements.txt · relation: references
- `litellm (emergent internal asset)` → `Model Switcher (Gemini/Claude/OpenAI, persisted)`  [AMBIGUOUS]
  backend/requirements.txt · relation: implements
- `Posthog Analytics Init (phc_DbsPb39SRc8z3EiQ6Dhj6ikv4H4rTKcht9d4sZSesceP)` → `GoalCoach (chat-first AI life coach)`  [AMBIGUOUS]
  frontend/public/index.html · relation: references
- `Emergent Main Script (assets.emergent.sh)` → `GoalCoach (chat-first AI life coach)`  [AMBIGUOUS]
  frontend/public/index.html · relation: references

## Knowledge Gaps
- **412 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+407 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 533 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `stripe 14.4.1 (unused in PRD?)` and `GoalCoach (chat-first AI life coach)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `litellm (emergent internal asset)` and `Model Switcher (Gemini/Claude/OpenAI, persisted)`?**
  _Edge tagged AMBIGUOUS (relation: implements) - confidence is low._
- **What is the exact relationship between `Posthog Analytics Init (phc_DbsPb39SRc8z3EiQ6Dhj6ikv4H4rTKcht9d4sZSesceP)` and `GoalCoach (chat-first AI life coach)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Emergent Main Script (assets.emergent.sh)` and `GoalCoach (chat-first AI life coach)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `next` connect `Preferences API` to `Sonner Toast Integration`, `CRACO Build Config`, `DB Tooling & Drivers`, `Auth.js Drizzle Adapter`, `Reject Proposal API`, `Confirm Proposal API`, `Next.js Middleware Routing`, `Guest Session Routes`, `GET API Routes (audit/history/export)`, `Auth Me API`?**
  _High betweenness centrality (0.215) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Root Package Dependencies` to `Frontend Package Dependencies`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `vitest` connect `CRACO Build Config` to `DB Tooling & Drivers`, `Auth.js Drizzle Adapter`, `Reject Proposal API`, `Confirm Proposal API`, `Guest Session Routes`, `GET API Routes (audit/history/export)`, `Preferences API`, `Auth Me API`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._