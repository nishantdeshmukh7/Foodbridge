# RMMM (Risk Mitigation, Monitoring, and Management) Plan

## Project: FoodBridge – Food Donation Platform

**Date:** 15/04/2026  
**Prepared By:** Risk Management Team  
**Project Description:** FoodBridge is a full-stack food donation platform connecting donors (restaurants, hotels, event organizers) with NGOs and volunteers to rescue surplus food and reduce food waste. Built with React + TypeScript frontend, Node.js + Express backend, PostgreSQL database, and JWT-based authentication.

---

## Step 1: Risk Table (Unsorted)

| Risk ID | Risks | Category | Probability | Impact | RMMM |
|---------|-------|----------|-------------|--------|------|
| 1 | Database server downtime or PostgreSQL connection failures disrupting platform operations | TE | 65% | 2 | Implement connection pooling, automated failover, regular database backups, and health check monitoring |
| 2 | JWT token security breach or unauthorized access to user accounts | PS | 55% | 1 | Enforce token rotation, reduce token expiry from 7 days, implement refresh tokens, add rate limiting and IP-based anomaly detection |
| 3 | Sudden increase in users and donation traffic causing performance degradation | PS | 50% | 2 | Implement horizontal scaling, load balancing, caching layers, and conduct regular load testing |
| 4 | Food expiry time mismanagement leading to delivery of expired food to recipients | BU | 70% | 1 | Implement automated expiry alerts, real-time countdown timers, donation auto-cancellation on expiry, and strict validation checks |
| 5 | Key team members leaving or lacking experience in React, TypeScript, Prisma, or PostgreSQL | ST | 40% | 3 | Conduct knowledge-sharing sessions, maintain comprehensive documentation, cross-train team members, and hire backup resources |
| 6 | Scope creep due to addition of features like real-time notifications, Google Maps, and payment integration | BU | 45% | 3 | Define scope boundaries clearly, implement change control process, get stakeholder sign-off before adding features |
| 7 | CORS policy and API integration failures between frontend and backend | DE | 60% | 2 | Maintain strict CORS configuration, implement automated API integration tests, and use API documentation tools like Swagger |
| 8 | Donor, NGO, or volunteer users failing to adopt the platform or providing unclear requirements | CU | 35% | 3 | Conduct user training sessions, gather continuous feedback, implement intuitive UI/UX, and run pilot programs before full launch |

---

## Step 2: Risk Table (Sorted by Probability – Descending Order)

| Risk ID | Risks | Category | Probability | Impact | RMMM |
|---------|-------|----------|-------------|--------|------|
| 4 | Food expiry time mismanagement leading to delivery of expired food to recipients | BU | 70% | 1 | Implement automated expiry alerts, real-time countdown timers, donation auto-cancellation on expiry, and strict validation checks |
| 1 | Database server downtime or PostgreSQL connection failures disrupting platform operations | TE | 65% | 2 | Implement connection pooling, automated failover, regular database backups, and health check monitoring |
| 7 | CORS policy and API integration failures between frontend and backend | DE | 60% | 2 | Maintain strict CORS configuration, implement automated API integration tests, and use API documentation tools like Swagger |
| 2 | JWT token security breach or unauthorized access to user accounts | PS | 55% | 1 | Enforce token rotation, reduce token expiry from 7 days, implement refresh tokens, add rate limiting and IP-based anomaly detection |
| 3 | Sudden increase in users and donation traffic causing performance degradation | PS | 50% | 2 | Implement horizontal scaling, load balancing, caching layers, and conduct regular load testing |
| 6 | Scope creep due to addition of features like real-time notifications, Google Maps, and payment integration | BU | 45% | 3 | Define scope boundaries clearly, implement change control process, get stakeholder sign-off before adding features |
| 5 | Key team members leaving or lacking experience in React, TypeScript, Prisma, or PostgreSQL | ST | 40% | 3 | Conduct knowledge-sharing sessions, maintain comprehensive documentation, cross-train team members, and hire backup resources |
| 8 | Donor, NGO, or volunteer users failing to adopt the platform or providing unclear requirements | CU | 35% | 3 | Conduct user training sessions, gather continuous feedback, implement intuitive UI/UX, and run pilot programs before full launch |

---

## Step 3: Risk Information Sheets (RIS)

---

### Risk Information Sheet (RIS) – Risk ID: 4

| Field | Details |
|-------|---------|
| **Risk ID** | 4 |
| **Date** | 15/04/2026 |
| **Probability** | 70% |
| **Impact** | 1 (Catastrophic) |

**Description:**  
Food expiry time mismanagement leading to delivery of expired or unsafe food to recipients (NGOs and beneficiaries). Since FoodBridge deals with perishable food items donated by restaurants, hotels, and event organizers, inaccurate expiry timestamps or delayed pickups could result in food safety violations and health hazards.

**Refinement & Context:**
- **Sub condition 1:** Donors may enter incorrect or overly optimistic expiry times when listing food donations, leading to food being available past its safe consumption window.
- **Sub condition 2:** Delays in the donation workflow (claim → pickup → delivery) may exceed the food's actual shelf life, especially for highly perishable items.
- **Sub condition 3:** Lack of automated expiry enforcement means expired donations could remain visible and claimable on the platform.

**Mitigation & Monitoring Strategies:**
1. Implement automated expiry countdown timers visible to all stakeholders (donor, NGO, volunteer)
2. Add server-side cron jobs to automatically change donation status to "EXPIRED" when `expiryTime` passes
3. Send push/email notifications to claimed NGOs and assigned volunteers 1 hour before expiry
4. Implement food category-wise default expiry limits (e.g., cooked food ≤ 4 hours, packaged food ≤ 24 hours)
5. Add validation to prevent claiming donations within 30 minutes of expiry

**Contingency Plan and Management:**
1. Immediately cancel all pickups and claims for expired donations and notify all affected parties
2. Implement a food safety incident reporting module for tracking any issues
3. Establish partnerships with food safety authorities for compliance guidance
4. Add a donor rating system that penalizes repeated incorrect expiry time entries

| Field | Details |
|-------|---------|
| **Trigger** | When a donation's `expiryTime` is approaching or has passed while still in AVAILABLE or CLAIMED status |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

### Risk Information Sheet (RIS) – Risk ID: 1

| Field | Details |
|-------|---------|
| **Risk ID** | 1 |
| **Date** | 15/04/2026 |
| **Probability** | 65% |
| **Impact** | 2 (Critical) |

**Description:**  
Database server downtime or PostgreSQL connection failures disrupting the entire FoodBridge platform operations. Since the application relies on a single PostgreSQL instance via Prisma ORM for all data operations (users, donations, pickups), any database outage would render the platform completely non-functional.

**Refinement & Context:**
- **Sub condition 1:** The current architecture uses a single PostgreSQL database without replication or failover mechanisms, creating a single point of failure.
- **Sub condition 2:** Prisma connection pool exhaustion under high concurrent load could cause database connection timeouts and service degradation.
- **Sub condition 3:** Unplanned database maintenance, disk space exhaustion, or corrupted migrations could lead to extended downtime.

**Mitigation & Monitoring Strategies:**
1. Set up PostgreSQL replication with a standby server for automatic failover
2. Configure Prisma connection pooling parameters (`connection_limit`, `pool_timeout`) appropriately for expected load
3. Implement automated daily database backups with point-in-time recovery capability
4. Set up database health monitoring with alerts for CPU, memory, disk usage, and connection count
5. Implement database migration testing in a staging environment before production deployment

**Contingency Plan and Management:**
1. Activate standby database server and redirect application connections
2. Restore from latest backup if data corruption occurs
3. Implement a read-only mode for the platform during database recovery
4. Notify all active users about temporary service disruption via email/SMS

| Field | Details |
|-------|---------|
| **Trigger** | When database response time exceeds 5 seconds or connection failures exceed 3 consecutive attempts |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

### Risk Information Sheet (RIS) – Risk ID: 7

| Field | Details |
|-------|---------|
| **Risk ID** | 7 |
| **Date** | 15/04/2026 |
| **Probability** | 60% |
| **Impact** | 2 (Critical) |

**Description:**  
CORS (Cross-Origin Resource Sharing) policy violations and API integration failures between the React frontend (running on `localhost:5173`) and Express backend (running on `localhost:3001`), causing broken user interactions and data flow disruptions across the platform.

**Refinement & Context:**
- **Sub condition 1:** Misconfigured CORS headers on the backend may block legitimate frontend API requests, especially during deployment when origins change from `localhost` to production domains.
- **Sub condition 2:** API contract mismatches between frontend React Query hooks and backend Express controllers could cause silent data errors or unhandled exceptions.
- **Sub condition 3:** JWT token transmission issues (missing Authorization headers, token format errors) can cause authentication failures across all protected routes.

**Mitigation & Monitoring Strategies:**
1. Maintain a centralized CORS configuration with environment-specific allowed origins
2. Implement automated API integration tests using Playwright for end-to-end validation
3. Use Swagger/OpenAPI documentation to maintain a single source of truth for API contracts
4. Add comprehensive error interceptors in the frontend API layer (`src/api/index.ts`) with user-friendly error messages
5. Implement API versioning to prevent breaking changes during updates

**Contingency Plan and Management:**
1. Revert to last known working CORS configuration from version control
2. Enable detailed backend logging for request/response debugging
3. Deploy a temporary API proxy to bypass CORS issues during emergency fixes
4. Conduct post-incident review to update CORS and API testing procedures

| Field | Details |
|-------|---------|
| **Trigger** | When frontend console reports CORS errors or API response status codes indicate 4xx/5xx errors on critical endpoints |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

### Risk Information Sheet (RIS) – Risk ID: 2

| Field | Details |
|-------|---------|
| **Risk ID** | 2 |
| **Date** | 15/04/2026 |
| **Probability** | 55% |
| **Impact** | 1 (Catastrophic) |

**Description:**  
JWT token security breach or unauthorized access to user accounts on the FoodBridge platform. Since the platform handles sensitive user data (personal information of donors, NGOs, and volunteers) and manages food donation workflows, a security breach could compromise trust, user safety, and platform integrity.

**Refinement & Context:**
- **Sub condition 1:** The current JWT token has a 7-day expiration period, which increases the window of vulnerability if a token is compromised or stolen from localStorage.
- **Sub condition 2:** Insufficient input validation or SQL injection vulnerabilities through Prisma queries could allow attackers to bypass authentication and access unauthorized data.
- **Sub condition 3:** Lack of rate limiting on login endpoints could enable brute-force attacks against user accounts, especially with weak default passwords (e.g., `admin123`, `donor123`).

**Mitigation & Monitoring Strategies:**
1. Reduce JWT token expiry to 1 hour and implement refresh token mechanism
2. Migrate token storage from localStorage to httpOnly secure cookies to prevent XSS-based token theft
3. Implement rate limiting (e.g., 5 login attempts per minute per IP) on authentication endpoints
4. Enforce strong password policies (minimum 8 characters, uppercase, lowercase, number, special character)
5. Add API request logging and anomaly detection for suspicious access patterns

**Contingency Plan and Management:**
1. Immediately invalidate all active JWT tokens by rotating the `JWT_SECRET`
2. Force password reset for all affected user accounts
3. Conduct a security audit to identify the breach vector and patch vulnerabilities
4. Notify all users about the security incident with recommended actions

| Field | Details |
|-------|---------|
| **Trigger** | When suspicious login activity is detected, unusual API access patterns emerge, or a user reports unauthorized account access |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

### Risk Information Sheet (RIS) – Risk ID: 3

| Field | Details |
|-------|---------|
| **Risk ID** | 3 |
| **Date** | 15/04/2026 |
| **Probability** | 50% |
| **Impact** | 2 (Critical) |

**Description:**  
Sudden increase in registered users (donors, NGOs, volunteers) and donation transaction volume causing severe performance degradation on the FoodBridge platform. As the platform gains traction in urban areas, concurrent users and real-time donation activities could overwhelm the current single-server architecture.

**Refinement & Context:**
- **Sub condition 1:** The current backend runs on a single Node.js Express server without clustering or load balancing, which creates a bottleneck under high concurrent requests.
- **Sub condition 2:** Frontend React Query caching may become inefficient with rapidly changing donation data (new listings, claims, status updates), causing excessive API calls.
- **Sub condition 3:** Large datasets in admin dashboard analytics (listing all users, all donations) without proper pagination could cause memory issues and slow response times.

**Mitigation & Monitoring Strategies:**
1. Implement Node.js clustering to utilize multiple CPU cores on the server
2. Add Redis-based caching for frequently accessed data (available donations, user profiles)
3. Optimize Prisma queries with proper indexing, select clauses, and cursor-based pagination
4. Implement React Query stale time and cache time tuning to reduce unnecessary re-fetches
5. Set up application performance monitoring (APM) tools to track response times and throughput

**Contingency Plan and Management:**
1. Scale horizontally by deploying additional server instances behind a load balancer
2. Implement request throttling to protect critical endpoints during traffic spikes
3. Optimize database queries and add missing indexes identified through slow query logs
4. Temporarily restrict non-essential features (analytics, reports) to preserve core functionality

| Field | Details |
|-------|---------|
| **Trigger** | When average API response time exceeds 2 seconds or server CPU utilization exceeds 80% for sustained periods |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

### Risk Information Sheet (RIS) – Risk ID: 6

| Field | Details |
|-------|---------|
| **Risk ID** | 6 |
| **Date** | 15/04/2026 |
| **Probability** | 45% |
| **Impact** | 3 (Marginal) |

**Description:**  
Scope creep due to continuous addition of new features such as real-time WebSocket notifications, Google Maps integration, mobile apps (React Native), payment integration, and chat functionality — all of which are listed as future enhancements but may be pushed into the current development sprint under stakeholder pressure.

**Refinement & Context:**
- **Sub condition 1:** Stakeholders may demand integration of Google Maps for real-time volunteer tracking, adding significant complexity to both frontend and backend architecture.
- **Sub condition 2:** Requests for payment integration (for premium donor features or tax receipts) introduce regulatory, security, and third-party dependency risks.
- **Sub condition 3:** Adding real-time notifications via WebSocket requires significant changes to the current HTTP-only REST API architecture.

**Mitigation & Monitoring Strategies:**
1. Define and document a clear project scope with stakeholder sign-off before each sprint
2. Implement a formal change control process — all new feature requests must include impact analysis
3. Prioritize features using MoSCoW method (Must have, Should have, Could have, Won't have)
4. Track scope changes in the project backlog and report deviations in sprint retrospectives
5. Maintain a "future enhancements" backlog separate from the current sprint scope

**Contingency Plan and Management:**
1. Escalate scope changes to the project sponsor with revised timeline and resource estimates
2. Negotiate with stakeholders to defer non-critical features to subsequent releases
3. Allocate a dedicated buffer sprint for handling approved scope changes
4. Reallocate team members from lower-priority tasks if approved changes must be accommodated

| Field | Details |
|-------|---------|
| **Trigger** | When more than 2 unplanned features are added to the sprint backlog or when sprint velocity drops below 70% of planned capacity |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

### Risk Information Sheet (RIS) – Risk ID: 5

| Field | Details |
|-------|---------|
| **Risk ID** | 5 |
| **Date** | 15/04/2026 |
| **Probability** | 40% |
| **Impact** | 3 (Marginal) |

**Description:**  
Key team members leaving the project or lacking adequate experience in the technology stack used by FoodBridge — React 18, TypeScript, Prisma ORM, PostgreSQL, TanStack Query, and Tailwind CSS/shadcn UI — resulting in development slowdowns and quality degradation.

**Refinement & Context:**
- **Sub condition 1:** Team members may lack hands-on experience with Prisma ORM and its migration system, leading to schema design issues and inefficient database queries.
- **Sub condition 2:** TypeScript strict mode and complex type definitions across the full stack may slow down developers unfamiliar with strong typing.
- **Sub condition 3:** Sudden departure of a team member who owns critical modules (e.g., authentication, donation workflow) could create knowledge silos and block development.

**Mitigation & Monitoring Strategies:**
1. Conduct weekly knowledge-sharing sessions on Prisma, React Query, and TypeScript best practices
2. Maintain comprehensive inline code documentation and architecture decision records
3. Implement pair programming and mandatory code reviews to spread domain knowledge
4. Create onboarding documentation for new team members with project-specific setup guides
5. Track team velocity and individual task completion rates for early detection of skill gaps

**Contingency Plan and Management:**
1. Engage external consultants or freelancers with expertise in the required technology stack
2. Reassign tasks to redistribute workload and reduce dependency on any single team member
3. Utilize shadcn/ui documentation and TanStack Query examples as reference for self-directed learning
4. Implement a 2-week handover period policy for any departing team member

| Field | Details |
|-------|---------|
| **Trigger** | When a team member submits a resignation or when task completion rate drops below 60% due to skill limitations |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

### Risk Information Sheet (RIS) – Risk ID: 8

| Field | Details |
|-------|---------|
| **Risk ID** | 8 |
| **Date** | 15/04/2026 |
| **Probability** | 35% |
| **Impact** | 3 (Marginal) |

**Description:**  
Donor, NGO, or volunteer users failing to adopt the FoodBridge platform or providing unclear, conflicting, or frequently changing requirements — resulting in low user engagement, feature-reality gaps, and wasted development effort.

**Refinement & Context:**
- **Sub condition 1:** Donors (restaurants, hotels) may resist adopting the platform due to the additional overhead of listing food donations with expiry times and pickup details.
- **Sub condition 2:** NGOs may have varying expectations about donation claiming workflows and may request customizations that conflict with the standardized process.
- **Sub condition 3:** Volunteers may find the pickup and delivery workflow cumbersome without real-time navigation support (Google Maps integration not yet implemented).

**Mitigation & Monitoring Strategies:**
1. Conduct user interviews and usability testing with representative donors, NGOs, and volunteers before major releases
2. Implement an intuitive, role-specific onboarding flow with guided tutorials for first-time users
3. Set up a feedback mechanism (in-app surveys, contact forms) to continuously capture user pain points
4. Track user engagement metrics (daily active users, donation completion rates, average time to claim)
5. Run a pilot program with 5-10 partner organizations before full-scale launch

**Contingency Plan and Management:**
1. Simplify the donation listing and claiming process based on user feedback
2. Provide dedicated support and training sessions for partner organizations
3. Redesign user interfaces based on usability test findings and analytics data
4. Consider offering incentives (recognition badges, impact statistics) to boost engagement

| Field | Details |
|-------|---------|
| **Trigger** | When user adoption rate falls below 30% of target within the first month of launch or when more than 50% of user feedback reports usability issues |
| **Status** | Mitigation actions initiated (Monitoring in progress) |
| **Assigned To** | Scrum Master |
| **Originator** | Risk Management Team |

---

## Reference Tables

### Risk Category Table

| Risk Category | Short Form | Explanation |
|--------------|-----------|-------------|
| Product Size | PS | Risks related to the overall size, scale, and complexity of the software to be developed |
| Business Impact | BU | Risks arising from business constraints such as market conditions, competition, and management decisions |
| Customer Characteristics | CU | Risks related to customer behavior, expectations, and the ability to communicate effectively with them |
| Process Definition | PD | Risks due to unclear, undefined, or poorly followed software development processes |
| Development Environment | DE | Risks associated with the availability, reliability, and quality of development tools and infrastructure |
| Technology to be Built | TE | Risks due to the complexity, novelty, or uncertainty of the technology used in the system |
| Staff Size & Experience | ST | Risks related to the skills, experience, and availability of the development team |

### Probability Scale

| Range | Interpretation |
|-------|---------------|
| 80% – 100% | Very High |
| 60% – 79% | High |
| 40% – 59% | Medium |
| 20% – 39% | Low |
| < 20% | Very Low |

### Impact Severity Scale

| Category | Impact Value | Description |
|----------|-------------|-------------|
| Catastrophic | 1 | Failure results in mission failure or costs exceeding $500K |
| Critical | 2 | Failure degrades system performance significantly or costs $100K–$500K |
| Marginal | 3 | Failure results in secondary mission degradation or costs $1K–$100K |
| Negligible | 4 | Failure creates inconvenience with minor cost impact under $1K |

---

*Document Version: 1.0*  
*Last Updated: 15/04/2026*  
*Project: FoodBridge – Food Donation Platform*
