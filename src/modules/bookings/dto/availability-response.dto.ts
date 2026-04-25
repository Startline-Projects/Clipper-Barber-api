export interface SlotDto {
  time: string;
  endTime: string;
  available: boolean;
  price: number;
}

export interface ServiceSummaryDto {
  id: string;
  name: string;
  durationMinutes: number;
  regularPrice: number;
  afterHoursPrice: number | null;
  dayOffPrice: number | null;
}

export interface AvailabilityDayDto {
  date: string;
  dayOfWeek: number;
  isWorkingDay: boolean;
  slotDurationMinutes: number | null;
  slots: {
    regular: SlotDto[];
    afterHours: SlotDto[];
    dayOff: SlotDto[];
  };
}

export interface AvailabilityResponseDto {
  barberId: string;
  services: ServiceSummaryDto[];
  totalDurationMinutes: number;
  days: AvailabilityDayDto[];
}
