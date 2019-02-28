import React, { Component } from 'react';
import { FormattedMessage } from 'react-intl';
import Container from '../components/Container';
import ContentBox from '../components/ContentBox';
import Flex from '../components/FlexColumns';
import Layout from '../components/Layout';
import CategoriesLinksList from '../components/CategoriesLinksList';
import PleaseAddYourBotPleaseThanks from '../components/PleaseAddYourBotPleaseThanks';

class Home extends Component {
  render() {
    return (
      <Layout>
        <Container>
          <h1>
            <FormattedMessage id="site.name" />
          </h1>
          <h2>
            <FormattedMessage id="site.subheading" />
          </h2>
        </Container>
        <Container>
          <Flex backwardsMobile="yesnt">
            <Flex columns="3">
              <CategoriesLinksList />
            </Flex>
            <Flex columns="9">
              <ContentBox>
                
              </ContentBox>
              <ContentBox>
                Hi
              </ContentBox>
            </Flex>
          </Flex>
          <PleaseAddYourBotPleaseThanks />
        </Container>
      </Layout>
    );
  }
}

export default Home;
