import type { Metadata } from 'next';

import { Screen } from '../../components/screen';
import { CV_PAGES, SCREEN_PAGES } from '../../lib/pages';

export const dynamicParams = false;
export function generateStaticParams() {
  return SCREEN_PAGES.map((screen) => ({ screen }));
}

type Props = { params: Promise<{ screen: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { screen } = await params;
  return { title: `${(CV_PAGES as Record<string, { title: string }>)[screen].title} · Coversight Demo` };
}

export default async function ScreenPage({ params }: Props) {
  const { screen } = await params;
  return <Screen page={screen} />;
}
