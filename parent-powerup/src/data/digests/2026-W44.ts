import type { Digest } from '../../types';

/**
 * This Week, 26 October 2026. Publications from 4 to 20 October 2026. Every item is a real
 * paper, summarised from its PubMed abstract.
 */
export const digest: Digest = {
  week: '2026-W44',
  weekOf: '2026-10-26',
  title: 'Brave steps, green spaces and teen moods',
  editorNote:
    'This week is about the quiet power of everyday moments: coaching a worried child through small brave steps, playing music together, getting outside. And for parents of teenagers, two studies that help make sense of moods and sleep.',
  items: [
    {
      id: 'w44-online-help-child-worries',
      kind: 'study',
      headline: 'Online, parent-led help for young children’s worries is good value',
      summary:
        'The MYCATS trial, in 95 primary and infant schools in England, offered parents of 4 to 7 year olds at risk of anxiety problems an online course, with therapist support, on helping their child manage worries (865 children took part). This analysis of costs found the course gave children a small gain in quality of life for about £244 extra per child. It had at least an 88% chance of being good value by the usual NHS measure.',
      takeaway:
        'You can be a powerful helper for an anxious young child, and guided online courses are a practical way to learn how. The approach, gently encouraging small brave steps rather than avoiding fears, is one you can start using at home.',
      issues: ['anxiety'],
      ages: { from: 4, to: 8 },
      source: {
        title:
          'Estimating the Economic Value of Supported Online Parent-Led Cognitive Behavioral Therapy to Prevent Child Anxiety Problems: Economic Evaluation of the MYCATS Cluster Randomized Controlled Trial.',
        authors: 'Yu S, Reardon T, Ukoumunne OC, et al.',
        journal: 'Journal of Medical Internet Research',
        published: '2026-10-08',
        pmid: '42849063',
        doi: '10.2196/87123',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42849063/',
      },
    },
    {
      id: 'w44-parent-led-autism-support',
      kind: 'study',
      headline: 'Parent-led support helped autistic toddlers more than therapist-only sessions',
      summary:
        'In a trial in India, autistic children aged 2 to 3 were randomly assigned either to a programme in which parents delivered the support themselves, guided by a therapist, or to standard sessions led by a therapist. Both groups improved over six months. The parent-led group improved more on an autism rating scale and on social and everyday skills.',
      takeaway:
        'You know your child best, and the everyday moments you share are a strong place for support to happen. If your child is autistic or being assessed, it is worth asking about parent coaching alongside any therapy.',
      issues: ['connection', 'behaviour'],
      ages: { from: 2, to: 3 },
      source: {
        title:
          'Effectiveness of Parent-mediated Intervention Versus Standard Therapist-based Intervention in Indian Children With Autism Spectrum Disorder: A Randomized Controlled Trial.',
        authors: 'Suman P, Kaur J, Pal S, et al.',
        journal: 'Journal of Developmental and Behavioral Pediatrics',
        published: '2026-10-07',
        pmid: '42841398',
        doi: '10.1097/DBP.0000000000001518',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42841398/',
      },
    },
    {
      id: 'w44-teen-sleep-weekends',
      kind: 'study',
      headline: 'Very short sleep and big weekend sleep shifts linked to low mood in teens',
      summary:
        'Using a national survey of 48,426 secondary school pupils in South Korea in 2025, researchers looked at how long and when teenagers slept. Shorter sleep, especially under five hours a night, and a bigger shift in sleep timing between school days and weekends were both linked to more low mood and suicidal thoughts. As this was a snapshot in time, it cannot show which came first.',
      takeaway:
        'Teen body clocks tend to run later, so aim for enough sleep and a fairly steady wake-up time, weekends included, rather than a strict early bedtime. If your teen seems low for a while, gently ask how they are, and talk to your GP if you are worried.',
      issues: ['sleep', 'feelings'],
      ages: { from: 12, to: 18 },
      source: {
        title:
          'Associations of sleep duration and sleep-timing patterns with depressive mood and suicidal outcomes in Korean adolescents.',
        authors: 'Son H, Kim BJ, Cha B, et al.',
        journal: 'BMC Psychiatry',
        published: '2026-10-13',
        pmid: '43021211',
        doi: '10.1186/s12888-026-08706-6',
        url: 'https://pubmed.ncbi.nlm.nih.gov/43021211/',
      },
    },
    {
      id: 'w44-green-space-calm',
      kind: 'study',
      headline: 'More greenery near home linked to lower stress and calmer behaviour',
      summary:
        'In a Belgian birth cohort, researchers mapped the green space around the homes and schools of children aged 4 to 6, measured a long-term stress hormone (cortisol) in their fingernails, and asked parents about behaviour. More low greenery, such as grass and shrubs, within 100 to 300 metres of home was linked to about 10 to 12% lower cortisol. It was also linked to fewer difficulties in several areas of behaviour.',
      takeaway:
        'Time around green things may help young children feel calmer, and it does not have to be a forest: a park, a garden or a tree-lined walk all count. This kind of study shows a link, not proof, but a daily dose of outdoors has little downside.',
      issues: ['behaviour', 'feelings'],
      ages: { from: 4, to: 7 },
      source: {
        title:
          'Associations of Early-Childhood Residential Green Space Exposure with Nail Cortisol Levels and Behavior in Young Children: Insights from the ENVIRONAGE Birth Cohort.',
        authors: 'Verheyen L, Alfano R, Sleurs H, et al.',
        journal: 'Environmental Science & Technology',
        published: '2026-10-13',
        pmid: '42916009',
        doi: '10.1021/acs.est.6c04150',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42916009/',
      },
    },
    {
      id: 'w44-music-and-movement',
      kind: 'study',
      headline: 'Moving to music boosted children’s self-control and handling of feelings',
      summary:
        'In a trial, 180 children aged 8 to 11 were randomly assigned to 12 weeks of music sessions with whole-body rhythm games, the same music sessions without the movement, or their usual activities. The movement group improved most in executive function (skills like focus, switching between tasks and self-control) and in managing emotions, and most of these gains held three months later. Effects on wellbeing and sleep were smaller.',
      takeaway:
        'Clapping games, dancing and musical statues mix music with stopping, starting and taking turns, which seems to give self-control a workout. They are an easy, joyful thing to do together at home.',
      issues: ['feelings', 'school'],
      ages: { from: 8, to: 12 },
      source: {
        title:
          'Effects of an embodied music intervention on executive function, emotion regulation and psychophysiological well-being in children: the role of movement-rhythm synchronization and self-regulation.',
        authors: 'Shu Q',
        journal: 'Frontiers in Psychology',
        published: '2026-10-20',
        pmid: '42978611',
        doi: '10.3389/fpsyg.2026.1988460',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42978611/',
      },
    },
    {
      id: 'w44-two-kinds-of-teen-irritability',
      kind: 'study',
      headline: 'Teen irritability comes in two kinds, and they point to different needs',
      summary:
        'Researchers followed 532 young people in a community study from age 12 to 21, separating a persistently irritable mood from episodes of temper outbursts. On average, irritable mood crept up slightly through adolescence while outbursts declined. A higher or rising irritable mood was linked to more depression, anxiety, suicidal thoughts and self-harm by 21, while frequent outbursts were linked more to behaviour difficulties.',
      takeaway:
        'Temper outbursts usually ease with age. A teen who seems irritable most of the time, for weeks on end, may be struggling with low mood or worry underneath, so it is worth a gentle conversation and, if it carries on, a chat with your GP.',
      issues: ['feelings', 'behaviour'],
      ages: { from: 12, to: 18 },
      source: {
        title:
          'Developmental trajectories of tonic and phasic irritability from ages 12 to 21: early predictors, co-development, and psychiatric outcomes in young adulthood.',
        authors: 'Silver J, Liu Q, Carlson GA, et al.',
        journal: 'Journal of Child Psychology and Psychiatry',
        published: '2026-10-04',
        pmid: '42830197',
        doi: '10.1111/jcpp.70239',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42830197/',
      },
    },
  ],
};
