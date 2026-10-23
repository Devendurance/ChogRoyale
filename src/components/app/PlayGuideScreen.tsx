"use client";

// Play guide screen (A4.4). The ruleset data is built on the server and
// arrives as a plain prop. This file only owns the Privy session and the
// player identity in the HUD.
//
// The guide itself is static reference content. A failed profile read does not
// hide it: the reader still gets the guide with an honest account notice.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import PlayGuideView from "./PlayGuideView";
import { useLobbyCatalog } from "./catalog-context";
import { resolvePlayer, type ProfilePayload } from "./lobby-model";
import { feedbackNoticeFor, sessionNotice } from "./feedback-model";
import { useMedia, useSaveData } from "@/components/site/use-media";
import type { LobbyNotice, LobbyPlayer } from "./lobby-types";
import type { PlayGuideData, PlayGuidePhase } from "./play-guide-types";

export default function PlayGuideScreen({ guide }: { guide: PlayGuideData }) {
  const catalog = useLobbyCatalog();
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const { login } = useLogin();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [notice, setNotice] = useState<LobbyNotice | null>(null);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const saveData = useSaveData();
  const calm = reducedMotion || saveData;

  const loadProfile = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setProfile(null);
      setNotice(sessionNotice("open the play guide"));
      return;
    }

    try {
      const res = await fetch("/api/players/me", { headers: { authorization: `Bearer ${token}` } });
      const body = (await res.json()) as {
        success: boolean;
        data?: { player: ProfilePayload };
        error?: { code?: string; message?: string; details?: { bootstrap?: boolean } };
      };
      if (body.success && body.data?.player) {
        setProfile(body.data.player);
        setNotice(null);
        return;
      }
      setProfile(null);
      setNotice(
        feedbackNoticeFor(
          {
            code: body.error?.code ?? "REQUEST_FAILED",
            message: body.error?.message ?? `The server answered ${res.status}.`,
            bootstrap: body.error?.details?.bootstrap === true,
          },
          "open the play guide"
        )
      );
    } catch {
      setProfile(null);
      setNotice(
        feedbackNoticeFor(
          { code: "NETWORK", message: "The play guide could not reach the server." },
          "read your account"
        )
      );
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const timer = setTimeout(() => void loadProfile(), 0);
    return () => clearTimeout(timer);
  }, [ready, authenticated, loadProfile]);

  const player: LobbyPlayer | null = useMemo(() => (profile ? resolvePlayer(profile) : null), [profile]);

  const phase: PlayGuidePhase = !ready ? "booting" : !authenticated ? "login" : "ready";

  const onSignIn = useCallback(() => {
    void login();
  }, [login]);

  const onSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <PlayGuideView
      phase={phase}
      player={player}
      guide={guide}
      catalog={catalog}
      notices={notice ? [notice] : []}
      calm={calm}
      status="Play guide loaded."
      onSignIn={onSignIn}
      onSignOut={onSignOut}
      onRefresh={() => void loadProfile()}
    />
  );
}
