# Naming Conventions

## Files

| File         | Pattern                    | Example                |
| ------------ | -------------------------- | ---------------------- |
| Module       | `<domain>.module.ts`       | `user.module.ts`       |
| Controller   | `<domain>.controller.ts`   | `user.controller.ts`   |
| Service      | `<domain>.service.ts`      | `user.service.ts`      |
| Create DTO   | `create-<domain>.dto.ts`   | `create-user.dto.ts`   |
| Update DTO   | `update-<domain>.dto.ts`   | `update-user.dto.ts`   |
| Response DTO | `<domain>-response.dto.ts` | `user-response.dto.ts` |
| Interface    | `<domain>.interface.ts`    | `user.interface.ts`    |
| Repository   | `<domain>.repository.ts`   | `user.repository.ts`   |

All filenames use **kebab-case**.

---

## Classes

| Class        | Pattern               | Example           |
| ------------ | --------------------- | ----------------- |
| Module       | `<Domain>Module`      | `UserModule`      |
| Controller   | `<Domain>Controller`  | `UserController`  |
| Service      | `<Domain>Service`     | `UserService`     |
| Create DTO   | `Create<Domain>Dto`   | `CreateUserDto`   |
| Update DTO   | `Update<Domain>Dto`   | `UpdateUserDto`   |
| Response DTO | `<Domain>ResponseDto` | `UserResponseDto` |
| Repository   | `<Domain>Repository`  | `UserRepository`  |

All classes use **PascalCase**.

---

## Interfaces

| Interface      | Pattern          | Example          |
| -------------- | ---------------- | ---------------- |
| Domain entity  | `I<Domain>`      | `IUser`          |
| Error response | `IErrorResponse` | `IErrorResponse` |
| Custom shapes  | `I<Descriptor>`  | `IUserFilters`   |

All interfaces are **prefixed with `I`** and use PascalCase.

---

## Service Method Names

Use the domain name as the subject of the verb phrase.

| Action         | Pattern                           | Example            |
| -------------- | --------------------------------- | ------------------ |
| Create         | `create<Domain>`                  | `createUser`       |
| Find all       | `findAll<Domain>s`                | `findAllUsers`     |
| Find one       | `find<Domain>ById`                | `findUserById`     |
| Find by field  | `find<Domain>By<Field>`           | `findUserByEmail`  |
| Update         | `update<Domain>`                  | `updateUser`       |
| Delete         | `delete<Domain>`                  | `deleteUser`       |
| Validate       | `validate<Domain>`                | `validateUser`     |
| Private mapper | `to<Target>`                      | `toResponseDto`    |
| Private helper | `build<Thing>` / `resolve<Thing>` | `buildFilterQuery` |

---

## Controller Method Names

Mirror the service method names exactly:

| Action  | Pattern            | Example        |
| ------- | ------------------ | -------------- |
| POST    | `create<Domain>`   | `createUser`   |
| GET all | `findAll<Domain>s` | `findAllUsers` |
| GET one | `find<Domain>ById` | `findUserById` |
| PATCH   | `update<Domain>`   | `updateUser`   |
| DELETE  | `delete<Domain>`   | `deleteUser`   |

---

## Variables & Parameters

- Local variables: **camelCase** (`userId`, `foundUser`, `responseDto`)
- Constructor-injected services: camelCase, prefixed with domain (`userService`, `orderRepository`)
- DTO parameters: always `dto` for request DTOs (`dto: CreateUserDto`)
- Entity / raw objects from repository: `entity` or `<domain>Entity` (`userEntity`)

---

## Constants & Enums

- Constants: **SCREAMING_SNAKE_CASE** (`MAX_RETRY_COUNT`)
- Enum names: **PascalCase** (`UserStatus`)
- Enum members: **SCREAMING_SNAKE_CASE** (`UserStatus.ACTIVE`)

---

## Quick Checklist

Before committing any generated file, verify:

- [ ] File name is kebab-case and matches the pattern above
- [ ] Class name is PascalCase and matches the pattern above
- [ ] Interfaces are prefixed with `I`
- [ ] Service methods match the verb-domain pattern
- [ ] Controller methods mirror service method names
- [ ] DTO parameter is always named `dto`
- [ ] No abbreviations (use `identifier` not `id` in variable names — but `id` is acceptable
      as an entity field name since it's a conventional short-form in ORMs)
