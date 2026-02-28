import SchoolScopedAdminPage from "../../../../../../components/SchoolScopedAdminPage";

export default function SuperSchoolAdminRoute({ params }) {
  return <SchoolScopedAdminPage schoolId={params.schoolId} />;
}
