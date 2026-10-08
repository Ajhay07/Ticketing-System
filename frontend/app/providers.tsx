"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // With TanStack's default staleTime of 0, every route change
            // re-fetched /api/me, notifications and the page's data on mount,
            // so each navigation waited on fresh API round trips even when the
            // data had just been loaded. 30s keeps ticket data fresh (mutations
            // still invalidate explicitly; polling queries keep their own
            // refetchInterval) while making back-and-forth navigation instant.
            // The cache is per browser tab, is cleared on sign-out (UserMenu),
            // and every fetch is still re-authorized server-side.
            staleTime: 30_000,
          },
        },
      })
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
