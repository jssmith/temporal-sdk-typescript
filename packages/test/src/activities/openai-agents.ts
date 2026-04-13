/**
 * Test activities for OpenAI Agents plugin testing.
 */

/**
 * Get weather for a location (mock implementation).
 */
export async function getWeather(input: { location: string }): Promise<string> {
  // Mock weather data
  const weatherData: Record<string, string> = {
    tokyo: 'Sunny, 22°C',
    london: 'Cloudy, 15°C',
    'new york': 'Partly cloudy, 18°C',
    paris: 'Rainy, 12°C',
    sydney: 'Clear, 25°C',
  };

  const location = input.location.toLowerCase();
  const weather = weatherData[location] ?? `Weather data not available for ${input.location}`;

  return JSON.stringify({
    location: input.location,
    weather,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Calculate the sum of two numbers.
 */
export async function calculateSum(input: { a: number; b: number }): Promise<string> {
  const result = input.a + input.b;
  return JSON.stringify({
    operation: 'sum',
    operands: [input.a, input.b],
    result,
  });
}

/**
 * Search for information (mock implementation).
 */
export async function searchInfo(input: { query: string }): Promise<string> {
  return JSON.stringify({
    query: input.query,
    results: [
      { title: `Result 1 for "${input.query}"`, snippet: 'Mock search result 1' },
      { title: `Result 2 for "${input.query}"`, snippet: 'Mock search result 2' },
    ],
  });
}
