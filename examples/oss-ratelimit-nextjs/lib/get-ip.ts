import { NextApiRequest } from 'next';
import { NextRequest } from 'next/server';
import { IncomingMessage } from 'http';
import ipaddr from 'ipaddr.js'; // Optional: for validation

/**
 * Represents objects that potentially hold request information needed to extract an IP.
 * This union type allows the function to work with different request objects
 * found in Next.js (API Routes, Middleware, potentially raw Node).
 */
type RequestLike =
  | NextApiRequest
  | NextRequest
  | IncomingMessage
  | { headers: Headers | NodeJS.Dict<string | string[]>; ip?: string; socket?: { remoteAddress?: string }; connection?: { remoteAddress?: string } };


/**
 * Represents the Headers object, accommodating both Node's dictionary-like
 * headers and the standard Web API Headers object.
 */
type HeadersLike = Headers | NodeJS.Dict<string | string[]>;

/**
 * Safely retrieves a header value from different header object types.
 * Handles cases where header names might be lowercased in Node's IncomingMessage.
 *
 * @param headers The Headers object or dictionary.
 * @param name The name of the header to retrieve (case-insensitive).
 * @returns The header value string or null if not found.
 */
function getHeader(headers: HeadersLike | undefined, name: string): string | null {
    if (!headers) return null;

    const lowerCaseName = name.toLowerCase();

    if (headers instanceof Headers) {
        // Standard Headers object (NextRequest, fetch)
        return headers.get(lowerCaseName);
    }

    // Node.js IncomingMessage headers (NextApiRequest)
    // Headers might be lowercased automatically by Node, or preserve case. Check both.
    const headerValue = headers[lowerCaseName] ?? headers[name];

    if (Array.isArray(headerValue)) {
        return headerValue[0]; // Return the first value if it's an array
    }
    if (typeof headerValue === 'string') {
        return headerValue;
    }

    return null;
}

/**
 * Optional: Validates if a string is a valid IPv4 or IPv6 address.
 * Uses 'ipaddr.js' for robust validation.
 *
 * @param ip The string to validate.
 * @returns True if the string is a valid IP address, false otherwise.
 */
function isValidIp(ip: string | null | undefined): ip is string {
    if (!ip) {
        return false;
    }
    // If ipaddr.js is not installed or validation is skipped,
    // you could implement a basic regex check or simply return true.
    if (typeof ipaddr === 'undefined') {
        console.warn("ipaddr.js not available. Skipping IP validation.");
        // Basic check (very permissive):
        // return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^::|^[0-9a-f:]+$/i.test(ip);
        return true; // Assume valid if library isn't present
    }

    try {
        ipaddr.parse(ip);
        return true;
    } catch (e) {
        return false;
    }
}


/**
 * Advanced function to extract the client's IP address from various request types in Next.js.
 *
 * It checks standard and platform-specific headers in a prioritized order,
 * handles proxy scenarios, and falls back to the direct connection address.
 * Includes optional validation using 'ipaddr.js'.
 *
 * @param req The request object (NextApiRequest, NextRequest, IncomingMessage, etc.).
 * @param options Configuration options.
 * @param options.trustProxy Chain of headers to trust. Defaults to a common secure order.
 * @param options.validateIp Whether to validate the found IP using ipaddr.js (default: true if ipaddr.js installed, false otherwise).
 * @returns The client's IP address (string) or null if not determinable.
 */
export function getIpFromRequest(
    req: RequestLike,
    options: {
        trustHeaders?: string[];
        validateIp?: boolean;
    } = {}
): string | null {
    const {
        trustHeaders = [
            // Platform-specific headers (often most reliable when present)
            'cf-connecting-ip',         // Cloudflare
            'x-vercel-forwarded-for',   // Vercel
            'x-real-ip',                // Nginx, common reverse proxies
            'x-forwarded-for',          // Standard, but requires careful handling
            // Add other trusted headers specific to your infrastructure here
        ],
        validateIp = typeof ipaddr !== 'undefined', // Default to true if library is available
    } = options;

    const headers = 'headers' in req ? req.headers : undefined;

    // 1. Check NextRequest's dedicated 'ip' property (App Router / Middleware)
    // This is often processed by Next.js/Vercel and can be reliable.
    if ('ip' in req && req.ip) {
         if (!validateIp || isValidIp(req.ip)) {
             return req.ip;
         }
    }

    // 2. Iterate through trusted headers in the specified order
    if (headers) {
        for (const headerName of trustHeaders) {
            let ip: string | null | undefined = getHeader(headers, headerName);

            if (ip) {
                // Special handling for x-forwarded-for: take the *first* non-empty value
                if (headerName.toLowerCase() === 'x-forwarded-for') {
                    const ips = ip.split(',').map(s => s.trim()).filter(Boolean);
                    ip = ips[0]; // The leftmost IP is typically the original client
                }

                if (ip && (!validateIp || isValidIp(ip))) {
                    return ip;
                }
            }
        }
    }

    // 3. Fallback to direct connection properties (less reliable behind proxies)
    let directIp: string | undefined | null = null;
    if ('socket' in req && req.socket?.remoteAddress) {
        // Primarily for NextApiRequest / IncomingMessage
        directIp = req.socket.remoteAddress;
    } else if ('connection' in req && req.connection?.remoteAddress) {
        // Older Node.js property or potential fallback
        directIp = req.connection.remoteAddress;
    }

    // V6 addresses might be prefixed with '::ffff:' when transitioning from v4
    if (directIp && directIp.startsWith('::ffff:')) {
        directIp = directIp.substring(7);
    }

    if (directIp && (!validateIp || isValidIp(directIp))) {
        return directIp;
    }

    // 4. Last attempt: Re-check req.ip if it exists but wasn't valid initially
    // (Unlikely scenario, but covers edge cases)
    if ('ip' in req && req.ip && (!validateIp || isValidIp(req.ip))) {
        return req.ip;
    }


    return null; // IP address could not be determined
}