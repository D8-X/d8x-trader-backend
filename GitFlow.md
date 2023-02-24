## `Backend Git Flow`

Following the gitflow that described here --> https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow

we had created 4 workflows that you can find on the `.github/workflows` path

1. Merge your branch to the `dev`
2. Draft a new relese manually
3. Review the automated `PR` created from the `release/*` branch and merge the `PR` (if you are satisfied) to the `main` branch (This will trigger the deployment to the `stage` environment)
4. Merge the automated `PR` that has been created to the `dev` branch to sync the environments

`Note:` When you create a `hotfix` branch and merge it to the main, an automated PR will be created, for merging the main to the dev branch.

# CI

`Draft new release`

- Triggered from https://github.com/D8-X/d8x-trader-backend/actions/workflows/draft-new-release.yaml You have to choose the `Run workflow` button and fill in the version that you want to draft

`Publish new release`

- Automated (After publishing the release a `PR` was created for merging the `main` branch to the `dev`)

# CD

`K8s AWS Dev Deployment`

- For the `Development` environment, any merge request from any branch`(feature, fix etc)` on the `dev` branch, triggers the pipeline and is deployed on the `K8s Dev` --> https://dev.testnet.d8x.exchange/

`K8s AWS Stage Deployment`

- Automated when the `PR` merge to the `main` --> https://app.testnet.d8x.exchange/
