import Link from 'next/link';
import {DynamicCodeBlock} from 'fumadocs-ui/components/dynamic-codeblock'
// Import necessary icons from lucide-react
import {
  Zap,
  Settings,
  Package,
  BarChart2,
  Type,
  GitBranch,
  Github,
  BookOpen, // Added for "Read the Docs"
  ArrowRight // Added for CTAs
} from 'lucide-react';

// --- Component for Feature Cards ---
interface FeatureCardProps {
  icon: React.ReactNode; // Icon is now required for visual consistency
  title: string;
  description: string;
  href?: string;
}

function FeatureCard({ icon, title, description, href }: FeatureCardProps) {
  const content = (
    <>
      {/* Icon styling */}
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2 text-neutral-800 dark:text-neutral-100">{title}</h3>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{description}</p>
    </>
  );

  // Base classes for the card
  const cardBaseClasses = "group relative p-6 bg-white dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/80 rounded-xl shadow-sm transition-all duration-300 ease-in-out";
  // Hover classes
  const cardHoverClasses = "hover:shadow-lg hover:border-neutral-300 dark:hover:border-neutral-600 hover:scale-[1.02]";

  if (href) {
    return (
      <Link href={href} className={`${cardBaseClasses} ${cardHoverClasses}`}>
        {content}
        {/* Subtle arrow on hover for linked cards */}
        <ArrowRight className="absolute top-5 right-5 h-5 w-5 text-neutral-400 dark:text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </Link>
    );
  }

  return (
    <div className={`${cardBaseClasses}`}>
      {content}
    </div>
  );
}

// --- Homepage Component ---
export default function HomePage() {
  // Example code snippet (unchanged)
  const exampleCode = `
import { Ratelimit, fixedWindow, getRedisClient } from 'oss-ratelimit';

// 1. Prepare Redis Client (using environment variables is recommended)
// Option A: Use the library's helper (handles connection logic)
const redisClientPromise = getRedisClient({
  url: process.env.RATELIMIT_REDIS_URL || 'redis://localhost:6379',
});
const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10, "10 s"),
  analytics: true,
});

async function handler(req) {
  const identifier = /* user ID or IP */;
  const { success } = await ratelimit.limit(identifier);

  if (!success) {
    return new Response("Rate limit exceeded", { status: 429 });
  }
  return new Response("Success!");
}
  `;

  // Define icon props
  const iconProps = {
    size: 24, // Slightly smaller icons for the cards
    strokeWidth: 1.5,
  };

  return (
    // Add more vertical padding overall
    <div className="container mx-auto px-6 py-16 md:py-24 lg:py-32">

      {/* Hero Section */}
      <section className="text-center mb-20 md:mb-28 lg:mb-36">
        {/* Optional: Subtle Badge/Pill */}
        {/* <div className="inline-block px-3 py-1 mb-6 text-sm font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 rounded-full">
          Open Source Rate Limiting
        </div> */}

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tighter text-neutral-900 dark:text-neutral-50 mb-5">
          Reliable Rate Limiting for Modern Apps
        </h1>
        <p className="text-lg md:text-xl text-neutral-600 dark:text-neutral-400 max-w-3xl mx-auto mb-10 leading-relaxed">
          oss-ratelimit provides production-ready, flexible rate limiting for Node.js & Next.js, built with performance and developer experience in mind.
        </p>
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-12">
          {/* Primary CTA */}
          <Link
            href="/docs" // Adjust link
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-500 dark:focus:ring-offset-neutral-900"
          >
            Get Started
            <ArrowRight size={18} />
          </Link>
          {/* Secondary CTA */}
          <a
            href="https://github.com/codersaadi/oss-ratelimit" // <-- CHANGE THIS LINK
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-neutral-300 dark:border-neutral-700 text-base font-medium rounded-md text-neutral-700 dark:text-neutral-300 bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-400 dark:focus:ring-offset-neutral-900"
          >
            <Github size={18} />
            View on GitHub
          </a>
        </div>

        {/* Code Preview - Enhanced styling */}
        <div className="max-w-3xl mx-auto text-left relative">
           <div className="absolute top-0 left-0 -ml-4 -mt-4 w-3 h-3 bg-neutral-300 dark:bg-neutral-600 rounded-full animate-pulse"></div>
           <DynamicCodeBlock code={exampleCode} lang='typescript'/>
        </div>
      </section>

      {/* Features Section */}
      <section className="mb-20 md:mb-28 lg:mb-36">
        <div className="text-center mb-14">
           <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 mb-4">
             Powerful Features, Simple API
           </h2>
           <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
             Everything you need to protect your applications from abuse and ensure availability.
           </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Pass icons using the iconProps */}
          <FeatureCard
            icon={<Zap {...iconProps} />}
            title="High Performance"
            description="Leverages efficient backends like Redis for minimal latency impact."
          />
          <FeatureCard
            icon={<Settings {...iconProps} />}
            title="Flexible Configuration"
            description="Choose from various algorithms (Sliding Window, Token Bucket) and customize limits."
            href="/docs/03-core-concepts"
          />
          <FeatureCard
            icon={<Package {...iconProps} />}
            title="Framework Agnostic"
            description="Integrates easily with Next.js, Express, Fastify, or any Node.js application."
            href="/docs/04-multiple-limiters-with-registry"
          />
          <FeatureCard
            icon={<BarChart2 {...iconProps} />}
            title="Built-in Analytics"
            description="Gain insights into rate limit activity with optional analytics tracking."
            href="/docs/08-ephemeral-caching-analytics" // Adjust if needed
          />
          <FeatureCard
            icon={<Type {...iconProps} />}
            title="TypeScript Native"
            description="Enjoy static typing, autocompletion, and a better developer experience."
          />
          <FeatureCard
            icon={<GitBranch {...iconProps} />}
            title="Open Source"
            description="Transparent, community-driven development hosted on GitHub."
            href="/docs/11-contributing"
          />
        </div>
      </section>

      {/* Call to Action Section - Cleaner design */}
      <section className="text-center bg-neutral-50 dark:bg-neutral-800/50 py-16 px-6 rounded-xl border border-neutral-200 dark:border-neutral-700/80">
         <BookOpen className="mx-auto h-10 w-10 text-neutral-500 dark:text-neutral-400 mb-6" strokeWidth={1.5} />
         <h2 className="text-2xl md:text-3xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
           Explore the Documentation
         </h2>
         <p className="text-md text-neutral-600 dark:text-neutral-400 mb-8 max-w-xl mx-auto">
           Find detailed guides, API references, and examples to integrate oss-ratelimit quickly.
         </p>
         {/* Match primary CTA style */}
         <Link
            href="/docs" // Adjust link
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-500 dark:focus:ring-offset-neutral-900"
          >
           Read the Docs
            <ArrowRight size={18} />
          </Link>
      </section>

    </div>
  );
}

// Optional: Add metadata for SEO (if this is app/page.tsx)
// import type { Metadata } from 'next';
// export const metadata: Metadata = {
//   title: 'oss-ratelimit | Flexible Rate Limiting for Node.js & Next.js',
//   description: 'Production-ready, open-source rate limiting for Node.js & Next.js. Inspired by Upstash Ratelimit with enhanced features and flexibility.',
// };