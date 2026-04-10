import { Controller } from '@nestjs/common';
import { BarbersService } from './barbers.service';

@Controller('barbers')
export class BarbersController {
  constructor(private readonly barbersService: BarbersService) {}
}
