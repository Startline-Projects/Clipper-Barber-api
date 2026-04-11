---
name: nestjs-domain-architecture
description: >
  Generates production-grade NestJS domain modules that strictly follow a layered
  architecture: module / controller / service / dto / (optional) repository. Use this
  skill whenever the user asks to scaffold, generate, create, or build a NestJS feature,
  domain, resource, endpoint, API, CRUD, or module — even if they only say something like
  "add a users feature" or "make an endpoint for orders". The skill enforces all project
  conventions: typed return values, DTO validation via class-validator, Swagger decorators,
  consistent error shape, and explicit public/private visibility on every method.
---

# NestJS Domain Architecture Skill

## Purpose

Scaffold one or more fully typed, production-ready NestJS domain modules that comply with
the project's strict layer contract. Every generated file must be copy-pasteable with zero
changes required before running.

---

## Layer Contract (non-negotiable)

| Layer                       | Responsibility                            | What it must NOT do                      |
| --------------------------- | ----------------------------------------- | ---------------------------------------- |
| **Controller**              | Route HTTP → Service call → return result | Contain any business logic               |
| **Service**                 | All business logic, data access calls     | Import HTTP concerns (Request, Response) |
| **DTO**                     | Shape & validate input / output           | Contain logic                            |
| **Repository** _(optional)_ | Wrap ORM / data-store calls               | Contain business logic                   |
| **Module**                  | Wire providers & exports                  | Contain logic                            |

---

## Strict Coding Rules

1. **Visibility** — Every method must have `public` or `private`.
2. **Return types** — Every method must declare an explicit return type. Use interfaces or DTOs only — never `any`, never bare primitives for domain objects.
3. **DTO-only input** — Controllers never accept a raw `@Body()` without a DTO class decorated with `class-validator`.
4. **Error shape** — All error responses must use `{ error: true, message: string }` (see `IErrorResponse` interface).
5. **Swagger** — Every controller endpoint must have exactly `@ApiOperation()`, `@ApiBody()` (where applicable), and `@ApiResponse()` for the success case only.
6. **Function naming** — Follow the conventions in `references/naming-conventions.md`.

## Quick Reference: Swagger Rules

```ts
@Post()
@ApiOperation({ summary: 'Create a new user' })
@ApiBody({ type: CreateUserDto })
@ApiResponse({ status: 201, description: 'User created successfully', type: UserResponseDto })
public async createUser(@Body() dto: CreateUserDto): Promise<UserResponseDto | IErrorResponse> { }
```

No `@ApiResponse` for 400 / 404 / 500 — those are handled globally.
