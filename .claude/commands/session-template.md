Context: I'm building the NestJS backend for a barbershop app.
See @CLAUDE.md for conventions.
Current phase: Phase 4 — Booking Engine.
Completed: auth module, barbers module, schedule builder endpoint.

Task: Build the availability calculation endpoint.
File to create: src/bookings/bookings.service.ts method getAvailableSlots()
Business rules:

- [paste the 5-step availability logic from the spec]
- Booking types: regular, after_hours, day_off — never mix them
- Return: string[] of ISO timestamps

Start with the service method. I will wire the controller after I review.
