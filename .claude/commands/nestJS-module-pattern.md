Every domain gets: module, controller, service, dto folder, and optionally a repository.
Controller only calls service. Service contains all business logic.
DTOs use class-validator decorators. Never accept raw body without DTO validation.
Error format: { error: true, message: string }
Swagger fro each endpoint
