import { Controller, Get, Header, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CITIES, COUNTRIES, DISTRICTS, METRO_STATIONS } from '@evtap/shared';
import { Public } from '../../common/decorators';

@ApiTags('reference')
@Controller('locations')
export class LocationsController {
  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  list() {
    return { countries: COUNTRIES, cities: CITIES, districts: DISTRICTS, metroStations: METRO_STATIONS };
  }
}

@Module({ controllers: [LocationsController] })
export class LocationsModule {}
