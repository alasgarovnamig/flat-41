import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { loginSchema, otpRequestSchema, otpVerifySchema, refreshSchema, registerSchema } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, ClientIp, CurrentUser, Public } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';

const meta = (req: Request, ip: string | null) => ({ userAgent: req.headers['user-agent'] ?? null, ip });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodPipe(otpRequestSchema)) body: z.output<typeof otpRequestSchema>) {
    return this.auth.requestOtp(body.phone);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body(new ZodPipe(otpVerifySchema)) body: z.output<typeof otpVerifySchema>, @Req() req: Request, @ClientIp() ip: string | null) {
    return this.auth.verifyOtp(body.phone, body.code, body.name, meta(req, ip));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body(new ZodPipe(registerSchema)) body: z.output<typeof registerSchema>, @Req() req: Request, @ClientIp() ip: string | null) {
    return this.auth.register(body, meta(req, ip));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: z.output<typeof loginSchema>, @Req() req: Request, @ClientIp() ip: string | null) {
    return this.auth.login(body.login, body.password, meta(req, ip));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.output<typeof refreshSchema>, @Req() req: Request, @ClientIp() ip: string | null) {
    return this.auth.refresh(body.refreshToken, meta(req, ip));
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  logout(@Body(new ZodPipe(refreshSchema)) body: z.output<typeof refreshSchema>) {
    return this.auth.logout(body.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
