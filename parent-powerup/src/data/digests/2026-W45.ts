import type { Digest } from '../../types';

/**
 * This Week, 2 November 2026. Publications from 13 to 28 October 2026. Every item is a real
 * paper, summarised from its PubMed abstract.
 */
export const digest: Digest = {
  week: '2026-W45',
  weekOf: '2026-11-02',
  title: 'Sleep, kindness and talking together',
  editorNote:
    'Two studies on sleep this week, from babies to schoolchildren, and two on calmer minds, for parents and for teens. If any of it feels close to home, go gently: small changes count.',
  items: [
    {
      id: 'w45-parent-mindfulness-adhd',
      kind: 'study',
      headline: 'Two online courses eased stress for parents of children with ADHD',
      summary:
        'In this trial, 248 parents of children aged 6 to 12 with ADHD symptoms were randomly assigned to an online mindfulness course or an online course about ADHD. Three months on, both groups reported lasting improvements in their children’s ADHD symptoms, in their own stress and wellbeing, and fewer critical comments at home. Only the mindfulness course also improved parents’ sleep.',
      takeaway:
        'Looking after your own mind, and learning about ADHD, both seem to help the whole family. As every parent had a course, it is hard to know how much of the change came from the courses themselves, but if your sleep is suffering, a short daily mindfulness practice may be worth a try.',
      issues: ['behaviour', 'feelings'],
      ages: { from: 6, to: 13 },
      source: {
        title:
          'The effects of an online mindfulness-based intervention for parents of children with attention deficit/hyperactivity disorder.',
        authors: 'Zhang ZJ, Lo HHM, Cheung RYM, et al.',
        journal: 'Journal of Affective Disorders',
        published: '2026-10-20',
        pmid: '42901396',
        doi: '10.1016/j.jad.2026.122646',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42901396/',
      },
    },
    {
      id: 'w45-baby-sleep-app',
      kind: 'study',
      headline: 'A baby sleep app with personal support helped babies and mothers sleep',
      summary:
        'In a small trial in South Korea, 32 mothers of babies aged 3 to 12 months were randomly assigned to a four-week phone app, offering baby sleep information, sleep tracking and personal support, or to a comparison group. Sleep was measured with movement-tracking wristbands. Babies in the app group spent less time awake in the night, and by 10 weeks their mothers were sleeping better and had lower depression scores.',
      takeaway:
        'Knowing what is normal for baby sleep, plus a bit of personal support, can help the whole household rest. This was a small study, so treat it as encouraging rather than certain, and talk to your health visitor if night waking is wearing you down.',
      issues: ['sleep'],
      ages: { from: 0.25, to: 1 },
      source: {
        title:
          'Effects of Mobile-Based Multicomponent Infant Sleep Intervention on Infants and Mothers: A Randomized Controlled Trial.',
        authors: 'Chae SM, Kim CH, Kim MR, et al.',
        journal: 'Maternal and Child Health Journal',
        published: '2026-10-28',
        pmid: '42955524',
        doi: '10.1007/s10995-026-04335-3',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42955524/',
      },
    },
    {
      id: 'w45-sleep-and-worries',
      kind: 'study',
      headline: 'Poor sleep in young schoolchildren linked to more worries and low mood later',
      summary:
        'Researchers followed 1,529 children in their first three years of primary school in Chongqing, China, measuring their sleep, anxiety and low mood twice. Children who slept worse at the start were more likely to have symptoms of anxiety and low mood later, even after allowing for how they felt at the start. Children whose sleep got worse over time also tended to feel worse.',
      takeaway:
        'Sleep and feelings go hand in hand, so a calm, regular bedtime is one of the kindest things you can protect. If your child has been sleeping badly for weeks, it is worth gently checking in about worries too.',
      issues: ['sleep', 'anxiety', 'feelings'],
      ages: { from: 6, to: 10 },
      source: {
        title: 'Study on the association between sleep quality and anxiety-depression symptoms in school-aged children.',
        authors: 'Chen J, Liu Y, Liu Q, et al.',
        journal: 'Frontiers in Public Health',
        published: '2026-10-20',
        pmid: '42978638',
        doi: '10.3389/fpubh.2026.1927475',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42978638/',
      },
    },
    {
      id: 'w45-teen-compassion-training',
      kind: 'study',
      headline: 'Eight weeks of compassion training helped teens handle feelings a year on',
      summary:
        'In four Chinese secondary schools, 34 classes (876 teenagers) were randomly assigned to eight weeks of compassion training or a relaxation programme of the same length. A year later, the compassion group had kept a small advantage in managing their emotions and in caring, helpful behaviour towards others. About 60% of pupils took part in the final follow-up.',
      takeaway:
        'Being kind to yourself and others is a skill that can be practised. At home, you could gently notice when your teen is hard on themselves and ask what they would say to a friend in the same spot.',
      issues: ['feelings', 'friends'],
      ages: { from: 12, to: 18 },
      source: {
        title:
          'Longitudinal effects of compassion training on emotion regulation and prosocial moral development among adolescents.',
        authors: 'Sun Y',
        journal: 'Frontiers in Psychology',
        published: '2026-10-13',
        pmid: '42947698',
        doi: '10.3389/fpsyg.2026.1969277',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42947698/',
      },
    },
    {
      id: 'w45-back-and-forth-talk',
      kind: 'study',
      headline: 'More back-and-forth chat linked to more words for toddlers using talking aids',
      summary:
        'This study looked again at two trials in which 109 parents and their toddlers with developmental delays were randomly assigned to different 12-week language programmes, some using communication aids (known as AAC) and some using speech alone. Conversational turns between parent and child grew during the programmes. In families using aids, more turns went with a bigger vocabulary, a link not seen with speech alone.',
      takeaway:
        'If your child uses, or is starting, a communication aid, everyday back-and-forth matters. Pause, wait and answer whatever they tell you, by voice, sign or aid: each turn is practice.',
      issues: ['connection'],
      ages: { from: 1, to: 4 },
      source: {
        title:
          'The Impact of Conversational Turn-Taking on Vocabulary Size in Toddlers With Developmental Delays Using Augmentative and Alternative Communication.',
        authors: 'Merilan-Mundava SJ, Sevcik RA, Romski M',
        journal: 'American Journal of Speech-Language Pathology',
        published: '2026-10-26',
        pmid: '42932260',
        doi: '10.1044/2026_AJSLP-25-00484',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42932260/',
      },
    },
    {
      id: 'w45-camhs-gcse-gap',
      kind: 'study',
      headline: 'The GCSE gap for young people seen by CAMHS has widened, a Welsh study finds',
      summary:
        'Using linked records for young people in Wales born between 1992 and 2003, researchers compared GCSE results for those who had and had not been seen by child and adolescent mental health services (CAMHS). Overall, fewer young people missed basic GCSE passes over time (6.9% down to 3.7%), but those who had attended CAMHS were about four times as likely to miss them. That gap grew wider for the younger group, especially for those who had stayed in hospital.',
      takeaway:
        'If your child is getting mental health support, it is fair to ask their school for help with learning too, such as a support plan, flexible deadlines or a named person to go to. Struggling with exams says nothing about your child’s effort or your parenting.',
      issues: ['school', 'feelings'],
      ages: { from: 11, to: 17 },
      source: {
        title:
          'Widening educational inequalities for young people attending child and adolescent mental health services: a longitudinal cohort study.',
        authors: "O'Hare K, Wertz J, Marryat L, et al.",
        journal: 'Journal of Child Psychology and Psychiatry',
        published: '2026-10-28',
        pmid: '42949553',
        doi: '10.1111/jcpp.70260',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42949553/',
      },
    },
  ],
};
