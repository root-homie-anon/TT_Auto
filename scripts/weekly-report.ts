import 'dotenv/config';
import { analyzePerformance, getWeeklyReport } from '../src/analyst/index.js';

function main(): void {
  console.log(getWeeklyReport());
  console.log('');
  analyzePerformance();
}

main();
