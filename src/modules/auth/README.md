Auth Module — AuthModule

1. Module Overview
   Purpose: Handles all identity and session management for the Barbershop API — registration, login, token lifecycle, and password recovery.

Business Domain: Authentication & Identity

2. Responsibilities
   Handles:

Barber multi-step onboarding (account → shop details → profile photo/bio)
Single-step client registration with username uniqueness enforcement
JWT-based login with role validation
Access token refresh and server-side logout
Password reset via Supabase OTP email flow
Profile photo upload to Supabase Storage
Does NOT handle:

Booking logic, payment processing, or service configuration
Email template customization (delegated to Supabase)
Profile updates post-onboarding (handled by BarbersModule / ClientsModule) 3. Architecture Breakdown
Controller — auth.controller.ts
Routes all /auth/\* requests. Contains zero business logic — delegates everything to AuthService. Applies guards, interceptors, and Swagger decorators at the route level.

Service — auth.service.ts
All business logic lives here:

Coordinates Supabase Auth (admin API) with DB row inserts/updates
Implements rollback on partial failures (e.g., deletes auth user if DB insert fails)
Builds role-specific login responses
Handles file upload to Supabase Storage
Guards
Guard File Purpose
JwtAuthGuard jwt-auth.guard.ts Validates Bearer token via Supabase, attaches user to request
RolesGuard roles.guard.ts Reads user_metadata.role from JWT, enforces @Roles() decorator
Interceptors / Pipes
FileInterceptor('photo') — used on barber/step3 for multipart upload. File stored in memory (max 5 MB), never written to disk.
Decorators
@CurrentUser() — extracts the attached SupabaseUserPayload from the request
@Roles(...roles) — metadata marker consumed by RolesGuard 4. Data Flow
Barber Onboarding (Step 1)

POST /auth/barber/step1
→ ValidationPipe validates BarberStep1Dto
→ AuthService.registerBarberStep1()
→ supabase.auth.admin.createUser() (creates auth identity, role=barber in user_metadata)
→ supabase.from('barbers').insert() (creates barbers row)
→ on DB error → admin.deleteUser() (rollback)
→ signInAndReturnTokens() (anon client signInWithPassword)
← { accessToken, refreshToken }
Login

POST /auth/login
→ ValidationPipe validates LoginDto
→ AuthService.login()
→ anonClient.auth.signInWithPassword()
→ getUserFromToken() (decode JWT, verify role matches dto.role)
→ buildBarberLoginResponse() OR buildClientLoginResponse()
→ if barber onboarding incomplete → inject redirectTo field
← { accessToken, refreshToken, id, email, username, redirectTo? }
Protected Endpoints

Request with Bearer token
→ JwtAuthGuard: token → supabase.getUserFromToken() → req.user
→ RolesGuard: req.user.user*metadata.role vs @Roles() metadata
→ Controller → Service 5. Dependencies
Internal
SupabaseModule / SupabaseService — all DB queries, auth operations, and storage uploads flow through this service
External Services
Service Usage
Supabase Auth (Admin API) Create/delete/update users, server-side sign-out
Supabase Auth (Anon Client) signInWithPassword, refreshSession
Supabase Database barbers and clients table reads/writes
Supabase Storage Profile photo upload to profile-photos bucket
NestJS Modules
MulterModule — in-memory file handling (5 MB limit)
@nestjs/swagger — full Swagger annotation on all endpoints 6. Public API
Method Route Description Auth
POST /auth/barber/step1 Create barber account, returns tokens Public
POST /auth/barber/step2 Save shop details Bearer + role=barber
POST /auth/barber/step3 Upload photo, bio, complete onboarding Bearer + role=barber
POST /auth/client/register Create client account, returns tokens Public
POST /auth/login Login (barber or client) Public
POST /auth/refresh Refresh access token Public
POST /auth/logout Invalidate session server-side Bearer
GET /auth/me Get current user profile Bearer
POST /auth/forgot-password Send password reset email Public
POST /auth/reset-password Reset password via OTP token Public 7. DTOs & Validation
DTO Endpoint Key Rules
BarberStep1Dto barber/step1 fullName max 100, email valid format, password min 8
BarberStep2Dto barber/step2 phone regex [+\d\s\-()], zipCode regex \d{5}(-\d{4})?, lat ∈ [-90,90], lng ∈ [-180,180]
BarberStep3Dto barber/step3 All optional; instagramHandle alphanumeric+.+* only, max 50; bio max 500
ClientRegisterDto client/register username alphanumeric+\_, min 3 / max 30, unique check in DB
LoginDto login role must be barber or client (enum); role sent by app, not user
RefreshTokenDto refresh refreshToken string, required
All DTOs use class-validator. ValidationPipe must be applied globally (or per-controller) in main.ts.

8. Error Handling
   Scenario Exception Notes
   Supabase user creation fails BadRequestException Supabase error message forwarded
   DB insert fails after auth user created BadRequestException Auth user is deleted (rollback) before throwing
   Invalid credentials UnauthorizedException Generic message — no email enumeration
   Role mismatch on login UnauthorizedException JWT role vs dto.role mismatch
   Invalid or expired refresh token UnauthorizedException
   Invalid OTP reset token UnauthorizedException
   Missing/malformed Authorization header UnauthorizedException Thrown in JwtAuthGuard
   Insufficient role for protected route ForbiddenException Thrown in RolesGuard
   Username already taken ConflictException Client registration only
   Barber/client profile not found NotFoundException GET /auth/me
   Photo upload or profile update fails InternalServerErrorException Storage or DB write failure
   forgot-password Always { success: true } Prevents email enumeration
   All error messages are centralized in src/common/messages.json.

9. Scalability Notes
   Current strengths:

Stateless JWT auth — horizontally scalable with no shared session store
Admin API used only for privileged mutations; anon client used for sign-in (correct pattern)
Rollback logic prevents orphaned auth users
Possible improvements:

Rate limiting — POST /auth/login, forgot-password, and reset-password should be rate-limited (e.g., @nestjs/throttler) to prevent brute-force and abuse
Refresh token rotation — Supabase handles this automatically, but consider enabling detect_compromised_tokens in the Supabase project settings
Step 3 file validation — add MIME type and file extension whitelist guard before uploading to storage
Onboarding resumption — login already returns redirectTo for incomplete barbers; consider a dedicated GET /auth/barber/onboarding-status endpoint for deep-link recovery 10. Example Usage
Barber Registration — Step 1

POST /auth/barber/step1
Content-Type: application/json

{
"fullName": "James Carter",
"email": "james@thefadefactory.com",
"password": "SecurePass1!"
}

{
"accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
"refreshToken": "v1.refreshtoken..."
}
Login

POST /auth/login
Content-Type: application/json

{
"email": "james@thefadefactory.com",
"password": "SecurePass1!",
"role": "barber"
}

{
"accessToken": "eyJ...",
"refreshToken": "v1...",
"id": "uuid-here",
"email": "james@thefadefactory.com",
"username": "James Carter",
"redirectTo": "barber/step2"
}
redirectTo is only present when barber onboarding is incomplete.

Get Current User

GET /auth/me
Authorization: Bearer eyJ...

{
"user_id": "uuid",
"full_name": "James Carter",
"shop_name": "The Fade Factory",
"onboarding_complete": true,
...
}
