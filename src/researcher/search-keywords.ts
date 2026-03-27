/**
 * Health niche search keywords organized by product category.
 * The researcher cycles through these to discover trending products.
 */
export const HEALTH_SEARCH_KEYWORDS: Record<string, string[]> = {
  supplements: [
    'vitamin supplement',
    'collagen supplement',
    'protein powder',
    'probiotic supplement',
    'magnesium supplement',
    'ashwagandha',
    'omega 3 fish oil',
    'multivitamin',
    'turmeric curcumin',
    'creatine supplement',
    'greens powder',
    'elderberry supplement',
    'vitamin d3',
    'zinc supplement',
    'biotin supplement',
  ],
  'fitness-tools': [
    'resistance bands',
    'massage gun',
    'fitness tracker',
    'yoga mat',
    'jump rope fitness',
    'kettlebell',
    'pull up bar',
    'ab roller',
    'foam roller',
    'grip strength trainer',
  ],
  recovery: [
    'muscle recovery',
    'ice pack therapy',
    'compression sleeve',
    'tens unit',
    'neck massager',
    'foot massager',
    'back stretcher',
    'posture corrector',
    'knee brace support',
    'heating pad',
  ],
  'sleep-wellness': [
    'sleep aid',
    'melatonin gummies',
    'weighted blanket',
    'sleep mask',
    'white noise machine',
    'aromatherapy diffuser',
    'sleep supplement',
    'blue light glasses',
    'pillow cervical',
    'humidifier bedroom',
  ],
  'weight-management': [
    'appetite suppressant',
    'fat burner supplement',
    'meal replacement shake',
    'food scale kitchen',
    'waist trainer',
    'portion control',
    'fiber supplement',
    'apple cider vinegar gummies',
    'detox tea',
    'protein bar',
  ],
};

export function getAllKeywords(): string[] {
  return Object.values(HEALTH_SEARCH_KEYWORDS).flat();
}

export function getCategoryForKeyword(keyword: string): string {
  for (const [category, keywords] of Object.entries(HEALTH_SEARCH_KEYWORDS)) {
    if (keywords.includes(keyword)) return category;
  }
  return 'general-health';
}
