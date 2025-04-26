import { NextRequest, NextResponse } from 'next/server';
import { ensureLimitersInitialized, NextAppLimiter, getLimiter } from './ratelimiter-registry';
import { getIpFromRequest } from './get-ip-util';

export async function withRateLimit(
  request: NextRequest,
  limiterName: NextAppLimiter,
  handler: (req: NextRequest) => Promise<NextResponse>,
  userId?: string,
) {
  // Ensure limiters are initialized
  await ensureLimitersInitialized();
  
  // Extract identifier for rate limiting (IP address, user ID, etc.)
  const ip = getIpFromRequest(request) ?? "ip_fallback"
  const identifier = userId ?? ip 
  try {
    // Apply rate limiting
    const result = await getLimiter(limiterName).limit(identifier);
    
    // Add rate limit headers to all responses
    const headers = {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': result.reset.toString()
    };
    
    // If rate limit exceeded
    if (!result.success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers }
      );
    }
    
    // Process request normally
    const response = await handler(request);
    
    // Add rate limit headers to the successful response
    Object.entries(headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    console.error('Rate limiter error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' }, 
      { status: 500 }
    );
  }
}

// app/api/somefunction/route.ts
export async function GET(request: NextRequest) {
  const userId = "123"
  return withRateLimit(request, "api", async (req) => {
    return NextResponse.json({
        success : true,
        messsage :"using with ratelimit "
    });
  },userId);
}