import SchoolAdminsPage from "../../../../../components/SchoolAdminsPage";

export default function SuperSchoolAdminsRoute({ params }) {
  return <SchoolAdminsPage schoolId={params.schoolId} />;
}
