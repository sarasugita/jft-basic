"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminConsole from "./AdminConsole";
import { createAdminSupabaseClient } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";

export default function SchoolScopedAdminPage({ schoolId }) {
  const router = useRouter();
  const supabase = useMemo(() => createAdminSupabaseClient(), []);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [school, setSchool] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error("school scoped session error:", error);
      syncAdminAuthCookie(data?.session ?? null);
      const nextSession = data?.session ?? null;
      if (!mounted) return;
      setSession(nextSession);
      if (!nextSession) {
        router.replace("/");
        return;
      }

      const { data: nextProfile } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", nextSession.user.id)
        .single();
      if (!mounted) return;
      setProfile(nextProfile ?? null);
      if (!nextProfile || nextProfile.role !== "super_admin") {
        router.replace("/");
        return;
      }

      const { data: schoolRow, error: schoolError } = await supabase
        .from("schools")
        .select("id, name, status")
        .eq("id", schoolId)
        .single();
      if (!mounted) return;
      if (schoolError || !schoolRow) {
        router.replace("/super/schools");
        return;
      }
      setSchool(schoolRow);
      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, [router, schoolId, supabase]);

  if (loading || !session || !profile || !school) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <AdminConsole
      forcedSchoolScope={school}
      changeSchoolHref="/super/schools"
      homeHref={`/super/schools/${schoolId}/admin`}
    />
  );
}
