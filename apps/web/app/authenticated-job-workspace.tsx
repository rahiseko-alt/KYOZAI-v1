"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { createBrowserSupabaseClient } from "../lib/supabase/browser";
import { JobWorkspace } from "./job-workspace";

type AuthenticatedJobWorkspaceProps = {
  initialJobId: string;
};

/** Supplies the short-lived browser session token required by the job APIs. */
export function AuthenticatedJobWorkspace({ initialJobId }: AuthenticatedJobWorkspaceProps) {
  const clientRef = useRef<SupabaseClient | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string>();

  const client = useCallback(() => {
    if (!clientRef.current) clientRef.current = createBrowserSupabaseClient();
    return clientRef.current;
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void Promise.resolve().then(client).then((supabase) => {
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        setSignedIn(Boolean(session));
        setReady(true);
      });
      unsubscribe = () => subscription.subscription.unsubscribe();
      return supabase.auth.getSession();
    }).then((result) => {
      if (!result || !active) return;
      const { data, error: sessionError } = result;
      if (sessionError) setError("ログイン状態を確認できませんでした。");
      setSignedIn(Boolean(data.session));
      setReady(true);
    }).catch(() => {
      if (!active) return;
      setError("認証の設定を確認できませんでした。");
      setReady(true);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [client]);

  const authenticatedFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { data, error: sessionError } = await client().auth.getSession();
    if (sessionError || !data.session?.access_token) throw new Error("authentication_required");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
    return fetch(input, { ...init, headers });
  }, [client]);

  if (!ready) return <main className="app-shell job-shell"><p>ログイン状態を確認しています。</p></main>;
  if (!signedIn) {
    return <main className="app-shell job-shell"><p role="alert">{error ?? "この教材jobを表示するにはログインしてください。"}</p><Link className="secondary-action" href="/">教材作成へ戻る</Link></main>;
  }
  return <main className="app-shell job-shell"><JobWorkspace initialJobId={initialJobId} fetcher={authenticatedFetch} /></main>;
}
