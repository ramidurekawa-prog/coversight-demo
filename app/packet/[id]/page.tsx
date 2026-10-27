import { Screen } from '../../../components/screen';
import { PACKET_IDS } from '../../../lib/pages';

export const dynamicParams = false;
export function generateStaticParams() {
  return PACKET_IDS.map((id) => ({ id }));
}
export const metadata = { title: 'Verification packet · Coversight Demo' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Screen page="packet" id={id} />;
}
