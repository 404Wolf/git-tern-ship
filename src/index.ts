import { Octokit } from "octokit";
import type User from "./types/User";
import OpenAI from "openai";

const octokit = new Octokit({ auth: process.env.GITHUB_API_KEY });
const openAi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Get all contributors for a given repo as a list of Github usernames.
 *
 * @param {string} repo The path to a repo after github.com/...
 */
async function getRepoActors(owner: string, repo: string) {
  const repoData = octokit.paginate.iterator(
    octokit.rest.repos.listActivities,
    { owner, repo },
  );

  const repoDataActors = new Set<string>();
  for await (const repoDataActionPage of repoData) {
    for (const repoDataAction of repoDataActionPage.data) {
      if (repoDataAction.actor && !repoDataAction.actor.login.match(/\[/)) {
        repoDataActors.add(repoDataAction.actor.login);
      }
    }
  }

  return [...repoDataActors];
}

/**
 * Get a object containing structured data about a Github user, from a username
 *
 * @param {string} username A Github user's Github username.
 */
async function lookupUser(username: string) {
  console.log("Looking up user: ", username);
  try {
    const { data } = await octokit.rest.users.getByUsername({ username });
    return data as User;
  } catch (e) {
    return null;
  }
}

/**
 * Scrape a github user's profile and obtain a list of potential companies they
 * contribute to or work at.
 *
 * @param {User} user The github user to scrape companies from.
 * @param {string} model OpenAI model to use to figure out whether given strings
 *                       are companies.
 */
async function findPotentialUserCompanies(
  user: User | null,
  model: string = "gpt-4o",
) {
  if (!user) return [];
  const potentialCompanies = `"{"bio": "${user.bio}", "company": "${user.company}}"`;
  const chatCompletion = await openAi.chat.completions.create({
    messages: [
      {
        role: "user",
        content:
          'Comma seperated list of mentioned names of companies. If it sounds like a bot do not include. Clean output. Say "NONE" if none\n\n' +
          potentialCompanies,
      },
    ],
    model,
  });
  const chatCompletionText = chatCompletion.choices[0].message.content;
  if (!chatCompletionText) return [];
  if (chatCompletionText.match(/NONE/)) {
    return [];
  }
  return chatCompletionText
    .split(",")
    .map((companyName) => companyName.toLowerCase())
    .map((companyName) => {
      return companyName.replace(/[^a-zA-Z0-9]/g, "");
    });
}

async function findRepoUsersCompanies(owner: string, repo: string) {
  const repoActors = await getRepoActors(owner, repo);
  const repoUsers = await Promise.all(repoActors.map(lookupUser));
  const repoCompanies = [
    ...new Set<String>(
      (
        await Promise.all(
          repoUsers.map((user) => findPotentialUserCompanies(user)),
        )
      ).flat(),
    ),
  ];
  return repoCompanies;
}

// const result = await findRepoUsersCompanies("NixOS/nixpkgs");
// console.log(result);

const result = await findRepoUsersCompanies("nix-community", "home-manager");
console.log(result);

