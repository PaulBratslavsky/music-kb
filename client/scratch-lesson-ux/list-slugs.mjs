const res = await fetch('http://localhost:1350/api/lessons?pagination[pageSize]=100&fields[0]=slug');
const json = await res.json();
console.log(json.data.map((d) => d.slug).join('\n'));
