import { localHashEmbedding, cosineSimilarity } from '/D:/Projects/GLM CORTEXT ORCASTRATOR/src/lib/cortex/embeddings.ts'

const a = localHashEmbedding('stripe webhook subscription renewal')
const b = localHashEmbedding('stripe webhook subscription renewal')
const c = localHashEmbedding('completely unrelated cooking recipe')

const ab = cosineSimilarity(a, b)
const ac = cosineSimilarity(a, c)
console.log('self-similarity:', ab.toFixed(4))
console.log('unrelated:', ac.toFixed(4))
if (ab < 0.99) throw new Error('identical texts should be ~1.0 similar')
if (ac > ab) throw new Error('unrelated should be less similar')
console.log('ALL_VECTOR_TESTS_PASSED')
