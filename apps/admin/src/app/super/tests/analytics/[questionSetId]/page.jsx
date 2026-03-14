import SuperQuestionSetComparisonPage from "../../../../../components/super/SuperQuestionSetComparisonPage";

export default function SuperQuestionSetComparisonRoute({ params }) {
  return <SuperQuestionSetComparisonPage questionSetId={params?.questionSetId ?? ""} />;
}
