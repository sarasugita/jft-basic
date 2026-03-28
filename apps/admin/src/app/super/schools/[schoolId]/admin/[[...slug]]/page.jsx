import SchoolScopedAdminPage from "../../../../../../components/SchoolScopedAdminPage";
import { resolveScopedAdminRouteState } from "../../../../../../lib/adminConsoleRoute";

export default function SuperSchoolAdminRoute({ params }) {
  return (
    <SchoolScopedAdminPage
      schoolId={params.schoolId}
      initialRouteState={resolveScopedAdminRouteState(params.slug)}
    />
  );
}
