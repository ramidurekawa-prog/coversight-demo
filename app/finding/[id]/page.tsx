import { Screen } from '../../../components/screen';
import { FINDING_IDS } from '../../../lib/pages';

export const dynamicParams = false;
export function generateStaticParams() {
  return FINDING_IDS.map((id) => ({ id }));
}
export const metadata = { title: 'Finding · Coversight Demo' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Screen page="finding" id={id} />;
}
