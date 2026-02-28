import { redirect } from "next/navigation";

export default function SuperSchoolPage({ params }) {
  redirect(`/super/schools/${params.schoolId}/admin`);
}
