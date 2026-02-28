import AdminConsole from "../../../../../../components/AdminConsole";

export default function SuperSchoolAdminRoute({ params }) {
  return (
    <AdminConsole
      forcedSchoolScope={{ id: params.schoolId, name: params.schoolId }}
      changeSchoolHref="/super/schools"
      homeHref={`/super/schools/${params.schoolId}/admin`}
    />
  );
}
